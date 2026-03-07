# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies including devDependencies for build
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build client and server
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built server and client
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 5001

# Set environment variables
ENV PORT=5001
ENV NODE_ENV=production

# Start the server
CMD ["node", "dist/index.cjs"]
