# SIDURI - Cloud Run Dockerfile
FROM node:26-alpine

# Install build tools only while native modules compile
RUN apk add --no-cache libstdc++ \
  && apk add --no-cache --virtual .build-deps python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including native modules)
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && apk del .build-deps

# Copy application code
COPY server/ ./server/
COPY public/ ./public/

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app/data

# Cloud Run expects PORT env var
ENV PORT=8080
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Expose port
EXPOSE 8080

USER node

# Start server
CMD ["node", "server/index.js"]
