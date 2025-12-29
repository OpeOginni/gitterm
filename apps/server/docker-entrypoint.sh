#!/bin/sh
set -e

echo "[entrypoint] Running migrations..."
cd /app/packages/db
bun run db:migrate

echo "[entrypoint] Running seed..."
bun run db:seed

echo "[entrypoint] Running admin seed..."
bun run db:seed-admin

echo "[entrypoint] Starting server..."
cd /app/apps/server
exec bun run dist/index.mjs
