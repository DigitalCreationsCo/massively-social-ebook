# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies including devDependencies for build
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build client and server
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built server and client
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 5000

# Set environment variables
ENV PORT=5000
ENV NODE_ENV=production

# Start the server
CMD ["node", "dist/index.cjs"]
