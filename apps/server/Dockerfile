# Build stage
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/server ./apps/server

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app
WORKDIR /app/apps/server
RUN bun run build

# Production stage
FROM oven/bun:1.2-slim AS runner

WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/server/package.json ./

# Copy database migrations for self-hosted bootstrap
# These are only used when DEPLOYMENT_MODE=self-hosted
COPY --from=builder /app/packages/db/src/migrations ./migrations

# Install only production dependencies
RUN bun install --production --frozen-lockfile || true

# Expose port (configurable via PORT env)
EXPOSE 3000

# Run the app
CMD ["bun", "run", "dist/index.mjs"]
