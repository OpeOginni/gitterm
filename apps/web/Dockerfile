FROM oven/bun:1.3 AS builder

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN bun install --frozen-lockfile

ENV NEXT_PUBLIC_ENABLE_BILLING=__NEXT_PUBLIC_ENABLE_BILLING__
ENV NEXT_PUBLIC_ENABLE_EMAIL_AUTH=__NEXT_PUBLIC_ENABLE_EMAIL_AUTH__
ENV NEXT_PUBLIC_ENABLE_GITHUB_AUTH=__NEXT_PUBLIC_ENABLE_GITHUB_AUTH__
ENV NEXT_PUBLIC_BASE_DOMAIN=__NEXT_PUBLIC_BASE_DOMAIN__
ENV NEXT_PUBLIC_ROUTING_MODE=path
ENV NEXT_PUBLIC_SERVER_URL=__NEXT_PUBLIC_SERVER_URL__
ENV NEXT_PUBLIC_LISTENER_URL=__NEXT_PUBLIC_LISTENER_URL__

RUN bun run turbo build --filter=web

FROM oven/bun:1.3-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web ./apps/web
COPY ./apps/web/docker-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/web

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh", "-c", "bun run next start --hostname ${HOSTNAME} --port ${PORT}"]
