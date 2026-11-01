
FROM node:20.20.2-alpine3.23 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY *.js ./
# Final runtime image
FROM node:20.20.2-alpine3.23
WORKDIR /app
EXPOSE 8080
# Upgrade Alpine packages to receive available security fixes
RUN apk update && \
    apk upgrade --no-cache && \
    rm -rf /var/cache/apk/*

COPY --from=builder /app /app
# This environment is handled through Kubernetes ConfigMap
# ENV MONGO="true" \
#     MONGO_URL="mongodb://mongodb:27017/catalogue"
RUN addgroup -S roboshop && \
    adduser -S roboshop -G roboshop && \
    chown -R roboshop:roboshop /app
USER roboshop
ENTRYPOINT ["node"]
CMD ["server.js"]


# FROM node:20
# WORKDIR /app
# COPY package.json .
# COPY *.js .
# RUN npm install
# ENV MONGO="true" \
#     MONGO_URL="mongodb://mongodb:27017/catalogue"
# CMD ["node", "server.js"]


