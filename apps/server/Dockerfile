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

# Copy root package files and node_modules
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules

# Copy only packages needed for db scripts (auth, db, env, config)
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/auth ./packages/auth
COPY --from=builder /app/packages/env ./packages/env
COPY --from=builder /app/packages/config ./packages/config

# Copy built server output
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

# Copy entrypoint script
COPY --from=builder /app/apps/server/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose port (configurable via PORT env)
EXPOSE 8080

# ============================================================================
# Railway Pre-deploy commands:
#
#   cd /app/packages/db && bun run db:migrate
#   cd /app/packages/db && bun run db:seed
#   cd /app/packages/db && bun run db:seed-admin
#
# ============================================================================

# Use entrypoint to start the server
ENTRYPOINT ["./docker-entrypoint.sh"]
