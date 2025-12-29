#!/bin/sh
set -e

echo "[entrypoint] Running migrations..."
cd /app/packages/db
bun run db:migrate

echo "[entrypoint] Running seed..."
bun run db:seed

echo "[entrypoint] Running admin seed..."
cd /app/apps/server
bun run db:seed-admin:prod

echo "[entrypoint] Starting server..."
exec bun run dist/src/index.mjs
