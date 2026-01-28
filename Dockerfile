# SIDURI - Cloud Run Dockerfile
FROM node:20-alpine

# Install build tools for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including native modules)
RUN npm install --omit=dev

# Copy application code
COPY server/ ./server/
COPY public/ ./public/

# Create data directory for SQLite
RUN mkdir -p /app/data

# Cloud Run expects PORT env var
ENV PORT=8080
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Expose port
EXPOSE 8080

# Start server
CMD ["node", "server/index.js"]
