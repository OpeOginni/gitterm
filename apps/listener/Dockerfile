# Build stage
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/listener ./apps/listener

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app
WORKDIR /app/apps/listener
RUN bun run build

# Production stage
FROM oven/bun:1.2-slim AS runner

WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/apps/listener/dist ./dist
COPY --from=builder /app/apps/listener/package.json ./

# Install only production dependencies
RUN bun install --production --frozen-lockfile || true

# Expose port (configurable via PORT env)
EXPOSE 3003

# Run the app
CMD ["bun", "run", "dist/index.mjs"]
