FROM oven/bun:1.3 AS builder

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN bun install --frozen-lockfile

# Enables output: "standalone" in next.config.ts (build-only; see the note there).
ENV NEXT_STANDALONE=1

# Placeholder values baked into the client bundle; docker-entrypoint.sh swaps
# them for the real NEXT_PUBLIC_* values at container start.
ENV NEXT_PUBLIC_DEPLOYMENT_MODE=__NEXT_PUBLIC_DEPLOYMENT_MODE__
ENV NEXT_PUBLIC_ENABLE_BILLING=__NEXT_PUBLIC_ENABLE_BILLING__
ENV NEXT_PUBLIC_ENABLE_EMAIL_AUTH=__NEXT_PUBLIC_ENABLE_EMAIL_AUTH__
ENV NEXT_PUBLIC_ENABLE_GITHUB_AUTH=__NEXT_PUBLIC_ENABLE_GITHUB_AUTH__
ENV NEXT_PUBLIC_BASE_DOMAIN=build.localhost
ENV NEXT_PUBLIC_ROUTING_MODE=__NEXT_PUBLIC_ROUTING_MODE__
ENV NEXT_PUBLIC_SERVER_URL=http://build.localhost:8888/api
ENV NEXT_PUBLIC_AUTH_URL=http://build.localhost:8888
ENV NEXT_PUBLIC_LISTENER_URL=http://build.localhost:8888/listener
ENV NEXT_PUBLIC_GITHUB_APP_NAME=__NEXT_PUBLIC_GITHUB_APP_NAME__
ENV NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY=__NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY__

RUN bun run turbo build --filter=web

FROM oven/bun:1.3-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Next.js standalone output (next.config.ts: output "standalone") contains the
# server plus only the traced runtime dependencies. Static assets and public
# files are not included by default and are copied alongside.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY ./apps/web/docker-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/web

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "run", "server.js"]
