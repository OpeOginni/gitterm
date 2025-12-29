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
RUN bun run turbo build --filter=worker

# Production stage
FROM oven/bun:1.3-slim AS runner

WORKDIR /app

# Copy built worker output only
COPY --from=builder /app/apps/worker/dist ./dist

# Default to idle-reaper (can be overridden to run daily-reset.mjs)
CMD ["bun", "run", "dist/idle-reaper.mjs"]
