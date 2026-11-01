
'use strict';

const express = require('express');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const pino = require('pino');

// Instana instrumentation
const instana = require('@instana/collector');
instana();

const app = express();
const logger = pino();

// Configuration
const PORT = process.env.CATALOGUE_SERVER_PORT || 8080;

const mongoURL =
    process.env.MONGO_URL ||
    process.env.MONGO ||
    'mongodb://mongodb:27017/catalogue';

const databaseName = process.env.MONGO_DATABASE || 'catalogue';
const collectionName = process.env.MONGO_COLLECTION || 'products';

const mongoOptions = {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000
};

// MongoDB state
let mongoConnected = false;
let productsCollection = null;

// Middleware
app.disable('x-powered-by');
app.use(express.json());

// Request logging and Instana tracing
app.use((req, res, next) => {
    const datacenter = crypto.randomInt(1, 4);

    try {
        const span = instana.currentSpan();

        if (span && typeof span.annotate === 'function') {
            span.annotate('datacenter', datacenter);
            span.annotate('http.method', req.method);
            span.annotate('http.url', req.originalUrl);
        }
    } catch (error) {
        logger.warn({ error: error.message }, 'Instana annotation failed');
    }

    logger.info({
        method: req.method,
        url: req.originalUrl,
        datacenter
    }, 'Incoming request');

    next();
});

// MongoDB connection
async function mongoConnect() {
    try {
        const client = await MongoClient.connect(mongoURL, mongoOptions);

        const db = client.db(databaseName);

        productsCollection = db.collection(collectionName);
        mongoConnected = true;

        logger.info('MongoDB connected successfully');

        return true;
    } catch (error) {
        mongoConnected = false;
        productsCollection = null;

        logger.error({
            error: error.message
        }, 'MongoDB connection failed');

        return false;
    }
}

// Start MongoDB connection without blocking application startup
const mongoConnectionPromise = mongoConnect();

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        app: 'OK',
        mongo: mongoConnected ? 'CONNECTED' : 'DISCONNECTED'
    });
});

// GET all products
app.get('/products', async (req, res) => {
    try {
        if (!mongoConnected || !productsCollection) {
            return res.status(500).json({
                message: 'MongoDB is not connected'
            });
        }

        const products = await productsCollection.find({}).toArray();

        return res.status(200).json(products);
    } catch (error) {
        logger.error({
            error: error.message
        }, 'Failed to fetch products');

        return res.status(500).json({
            message: 'Unable to fetch products'
        });
    }
});

// GET products by category
app.get('/products/:cat', async (req, res) => {
    try {
        if (!mongoConnected || !productsCollection) {
            return res.status(500).json({
                message: 'MongoDB is not connected'
            });
        }

        const category = req.params.cat;

        const products = await productsCollection
            .find({ categories: category })
            .toArray();

        return res.status(200).json(products);
    } catch (error) {
        logger.error({
            error: error.message
        }, 'Failed to fetch products by category');

        return res.status(500).json({
            message: 'Unable to fetch products by category'
        });
    }
});

// GET product by SKU
app.get('/product/:sku', async (req, res) => {
    try {
        if (!mongoConnected || !productsCollection) {
            return res.status(500).json({
                message: 'MongoDB is not connected'
            });
        }

        const sku = req.params.sku;

        const product = await productsCollection.findOne({
            sku: sku
        });

        if (!product) {
            return res.status(404).json({
                message: 'Product not found'
            });
        }

        return res.status(200).json(product);
    } catch (error) {
        logger.error({
            error: error.message
        }, 'Failed to fetch product by SKU');

        return res.status(500).json({
            message: 'Unable to fetch product'
        });
    }
});

// GET all categories
app.get('/categories', async (req, res) => {
    try {
        if (!mongoConnected || !productsCollection) {
            return res.status(500).json({
                message: 'MongoDB is not connected'
            });
        }

        const categories = await productsCollection.distinct('categories');

        return res.status(200).json(categories);
    } catch (error) {
        logger.error({
            error: error.message
        }, 'Failed to fetch categories');

        return res.status(500).json({
            message: 'Unable to fetch categories'
        });
    }
});

// GET products by search text
app.get('/search/:text', async (req, res) => {
    try {
        if (!mongoConnected || !productsCollection) {
            return res.status(500).json({
                message: 'MongoDB is not connected'
            });
        }

        const searchText = req.params.text;

        // Escape special regular-expression characters
        const escapedText = searchText.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );

        const products = await productsCollection
            .find({
                name: {
                    $regex: escapedText,
                    $options: 'i'
                }
            })
            .toArray();

        return res.status(200).json(products);
    } catch (error) {
        logger.error({
            error: error.message
        }, 'Product search failed');

        return res.status(500).json({
            message: 'Unable to search products'
        });
    }
});

// Handle unknown routes
app.use((req, res) => {
    res.status(404).json({
        message: 'Route not found'
    });
});

// Handle unexpected errors
app.use((error, req, res, next) => {
    logger.error({
        error: error.message
    }, 'Unhandled application error');

    res.status(500).json({
        message: 'Internal server error'
    });
});

// Start server only when executed directly
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Catalogue service listening on port ${PORT}`);
    });
}

// Export app for Jest and Supertest
module.exports = app;
