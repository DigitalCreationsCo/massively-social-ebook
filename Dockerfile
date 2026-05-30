# Build stage
FROM node:20-bookworm AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install && npm install @rollup/rollup-linux-x64-gnu

# Copy source code
COPY . .

ARG APP_BUILD_TAG
ENV VITE_APP_BUILD_TAG=$APP_BUILD_TAG

ARG VITE_MIXPANEL_TOKEN
ENV VITE_MIXPANEL_TOKEN=$VITE_MIXPANEL_TOKEN

# Build narrative engine dependency
RUN cd packages/narrative-engine && npm run build
# Build client and server
RUN npm run build

# Runtime stage
FROM node:20-bookworm

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy built server and client and dependency
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/admin/dist ./admin/dist
COPY --from=builder /app/packages/narrative-engine/dist ./packages/narrative-engine/dist

# Expose port
EXPOSE 5001

# Set environment variables
ENV PORT=5001
ENV NODE_ENV=production

# Start the server
CMD ["node", "dist/index.js"]
