# ===========================================
# Instakand - Instagram Scraper
# Multi-stage Dockerfile for production
# ===========================================

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production
FROM mcr.microsoft.com/playwright:v1.48.0-noble

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN groupadd -r instakand && useradd -r -g instakand instakand

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create directories for output and sessions
RUN mkdir -p /app/output /app/sessions /app/logs && \
    chown -R instakand:instakand /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the application port
EXPOSE 3000

# Switch to non-root user
USER instakand

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/scraper/system-status', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["node", "dist/main.js"]
