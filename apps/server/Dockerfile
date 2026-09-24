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
RUN bun run turbo build --filter=server

# Production stage
FROM oven/bun:1.3-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_MIGRATIONS_DIR=/app/migrations

# The server and its bootstrap scripts (migrate, seed, seed-admin) are fully
# bundled by tsdown, so no node_modules are needed at runtime. Only the SQL
# migration files are copied alongside.
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/packages/db/src/migrations ./migrations
COPY --from=builder /app/apps/server/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose port (configurable via PORT env)
EXPOSE 8080

# Migrations, seeding, and admin setup run in docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
