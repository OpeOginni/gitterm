# Build stage
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app
WORKDIR /app/apps/worker
RUN bun run build

# Production stage
FROM oven/bun:1.3-slim AS runner

WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/apps/worker/dist ./dist
COPY --from=builder /app/apps/worker/package.json ./

# Install only production dependencies
RUN bun install --production --frozen-lockfile || true

# Default to idle-reaper (can be overridden to run daily-reset.mjs)
CMD ["bun", "run", "dist/idle-reaper.mjs"]
