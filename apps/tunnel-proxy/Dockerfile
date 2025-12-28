# Build stage
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/tunnel-proxy ./apps/tunnel-proxy

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app
WORKDIR /app/apps/tunnel-proxy
RUN bun run build

# Production stage
FROM oven/bun:1.2-slim AS runner

WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/apps/tunnel-proxy/dist ./dist
COPY --from=builder /app/apps/tunnel-proxy/package.json ./

# Install only production dependencies
RUN bun install --production --frozen-lockfile || true

# Expose port (configurable via PORT env)
EXPOSE 3002

# Run the app
CMD ["bun", "run", "dist/index.mjs"]
