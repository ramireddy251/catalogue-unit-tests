
const instana = require('@instana/collector');

// Initialize Instana before loading other application modules
instana({
    tracing: {
        enabled: true
    }
});

const { MongoClient } = require('mongodb');
const bodyParser = require('body-parser');
const express = require('express');
const crypto = require('crypto');
const pino = require('pino');
const expPino = require('express-pino-logger');

const logger = pino({
    level: 'info'
});

const expLogger = expPino({
    logger
});

// MongoDB configuration
const mongoURL =
    process.env.MONGO_URL || 'mongodb://mongodb:27017/catalogue';

const app = express();

let db;
let collection;
let mongoConnected = false;
let mongoRetryTimer;
let mongoClient;

let isConnecting = false;

// Disable Express framework information disclosure
app.disable('x-powered-by');

// Middleware
app.use(expLogger);

app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

// Instana datacenter annotation
app.use((req, res, next) => {
    const dcs = [
        'asia-northeast2',
        'asia-south1',
        'europe-west3',
        'us-east1',
        'us-west1'
    ];

    const span = instana.currentSpan();

    const randomIndex = crypto.randomInt(0, dcs.length);

    if (span && typeof span.annotate === 'function') {
        span.annotate(
            'custom.sdk.tags.datacenter',
            dcs[randomIndex]
        );
    }

    next();
});

// Request body parsing
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Generic API error handler
function handleDatabaseError(req, res, error, message) {
    req.log.error({ err: error }, message);

    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error'
        });
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({
        app: 'OK',
        mongo: mongoConnected
    });
});

// Get all products
app.get('/products', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('Database not available');

        return res.status(500).json({
            error: 'Database not available'
        });
    }

    try {
        const products = await collection.find({}).toArray();
        res.json(products);
    } catch (error) {
        handleDatabaseError(
            req,
            res,
            error,
            'Failed to retrieve products'
        );
    }
});

// Get product by SKU
app.get('/product/:sku', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('Database not available');

        return res.status(500).json({
            error: 'Database not available'
        });
    }

    try {
        const delay = Number(process.env.GO_SLOW) || 0;

        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const product = await collection.findOne({
            sku: req.params.sku
        });

        if (product) {
            req.log.info({ sku: req.params.sku }, 'Product found');
            return res.json(product);
        }

        return res.status(404).send('SKU not found');
    } catch (error) {
        handleDatabaseError(
            req,
            res,
            error,
            'Failed to retrieve product by SKU'
        );
    }
});

// Get products by category
app.get('/products/:cat', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('Database not available');

        return res.status(500).json({
            error: 'Database not available'
        });
    }

    try {
        const products = await collection.find({
            categories: req.params.cat
        }).sort({
            name: 1
        }).toArray();

        if (products.length > 0) {
            return res.json(products);
        }

        return res.status(404).send(
            'No products for ' + req.params.cat
        );
    } catch (error) {
        handleDatabaseError(
            req,
            res,
            error,
            'Failed to retrieve products by category'
        );
    }
});

// Get all categories
app.get('/categories', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('Database not available');

        return res.status(500).json({
            error: 'Database not available'
        });
    }

    try {
        const categories = await collection.distinct('categories');
        res.json(categories);
    } catch (error) {
        handleDatabaseError(
            req,
            res,
            error,
            'Failed to retrieve categories'
        );
    }
});

// Search products by name and description
app.get('/search/:text', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('Database not available');

        return res.status(500).json({
            error: 'Database not available'
        });
    }

    try {
        const hits = await collection.find({
            $text: {
                $search: req.params.text
            }
        }).toArray();

        res.json(hits);
    } catch (error) {
        handleDatabaseError(
            req,
            res,
            error,
            'Failed to search products'
        );
    }
});

// MongoDB connection
async function mongoConnect() {
    if (isConnecting || mongoConnected) {
        return;
    }

    isConnecting = true;

    try {
        const client = new MongoClient(mongoURL, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000
        });

        await client.connect();

        mongoClient = client;
        db = client.db('catalogue');
        collection = db.collection('products');

        mongoConnected = true;

        logger.info('MongoDB connected');

        client.on('close', () => {
            mongoConnected = false;
            logger.error('MongoDB connection closed');
            scheduleMongoRetry();
        });

        client.on('error', error => {
            logger.error({ err: error }, 'MongoDB connection error');
        });

    } catch (error) {
        mongoConnected = false;

        logger.error(
            { err: error },
            'MongoDB connection failed'
        );

        scheduleMongoRetry();
    } finally {
        isConnecting = false;
    }
}

// MongoDB retry scheduling
function scheduleMongoRetry() {
    if (mongoRetryTimer || mongoConnected) {
        return;
    }

    mongoRetryTimer = setTimeout(() => {
        mongoRetryTimer = null;
        mongoConnect();
    }, 2000);
}

// Start MongoDB connection
mongoConnect();

// Start Express server
const port = process.env.CATALOGUE_SERVER_PORT || 8080;

app.listen(port, () => {
    logger.info({ port }, 'Catalogue service started');
});

module.exports = app;
