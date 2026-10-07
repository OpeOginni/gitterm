# One image for both chat bots. Build from the repository root:
#   docker build -f packages/bot/docker/Dockerfile -t gitterm-bot .
FROM oven/bun:1.3.14 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json bun.lock turbo.json ./
COPY packages ./packages
COPY apps ./apps

# Only the bots and what they depend on, not the whole monorepo.
RUN bun install --frozen-lockfile --filter @gitterm/slack-bot --filter @gitterm/discord-bot
# The bots import the SDK's and the bot engine's build output.
RUN cd packages/sdk && bun build src/index.ts src/direct/index.ts --outdir dist --target node \
  --format esm --packages external
RUN cd packages/bot && bun build src/index.ts --outdir dist --target node --format esm \
  --packages external

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
