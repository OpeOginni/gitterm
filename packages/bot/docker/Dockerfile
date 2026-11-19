# One image for both chat bots. Build from the repository root:
#   docker build -f packages/bot/docker/Dockerfile -t gitterm-bot .
FROM oven/bun:1.3.14 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN bun install --frozen-lockfile
# The bots import the build output of the packages they depend on (bot engine, SDK, agent
# runtime); this is the build CI and `publish:bots` run, dependencies first.
RUN bun run build:bots

# Each bot bundles into one file with its dependencies, so the image needs no node_modules.
RUN bun build packages/slack-bot/src/cli.ts --target bun --outfile /out/slack.js \
  && bun build packages/discord-bot/src/cli.ts --target bun --outfile /out/discord.js

FROM oven/bun:1.3.14-slim

COPY --from=builder /out /app
COPY packages/bot/docker/entrypoint.sh /usr/local/bin/gitterm-bot
RUN chmod +x /usr/local/bin/gitterm-bot

# The bot keeps its thread-to-session state here; mount a volume to keep it across restarts.
# A .env file mounted here is loaded too.
WORKDIR /data
VOLUME /data

ENTRYPOINT ["gitterm-bot"]
