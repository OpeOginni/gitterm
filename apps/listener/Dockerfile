# Build stage
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock turbo.json ./
COPY packages ./packages
COPY apps ./apps

# Install dependencies
RUN bun install --frozen-lockfile

# Build using turbo for proper workspace/catalog resolution
RUN bun run turbo build --filter=listener

# Production stage
FROM oven/bun:1.3-slim AS runner

WORKDIR /app

# Copy built listener output only
COPY --from=builder /app/apps/listener/dist ./dist

# Expose port (configurable via PORT env)
EXPOSE 8080

# Run the app
CMD ["bun", "run", "dist/index.mjs"]
