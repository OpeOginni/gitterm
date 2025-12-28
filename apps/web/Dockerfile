# Build stage
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/web ./apps/web

# Install dependencies
RUN bun install --frozen-lockfile

# Build the Next.js app
WORKDIR /app/apps/web
RUN bun run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
