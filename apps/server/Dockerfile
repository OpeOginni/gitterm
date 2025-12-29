# Build stage
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app
WORKDIR /app/apps/server
RUN bun run build

# Build standalone migration and seed scripts (bundle all dependencies)
RUN bun build scripts/migrate.ts --outfile dist/migrate.mjs --target bun --minify
RUN bun build scripts/seed.ts --outfile dist/seed.mjs --target bun --minify

# Production stage
FROM oven/bun:1.3-slim AS runner

WORKDIR /app

# Copy built output only (no node_modules needed - scripts are bundled)
COPY --from=builder /app/apps/server/dist ./dist

# Copy database migrations
COPY --from=builder /app/packages/db/src/migrations ./migrations

# Copy entrypoint script
COPY --from=builder /app/apps/server/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose port (configurable via PORT env)
EXPOSE 3000

# Use entrypoint to start the server (migrations/seeding are intentionally manual / pre-deploy)
ENTRYPOINT ["./docker-entrypoint.sh"]
