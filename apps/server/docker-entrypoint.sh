#!/bin/sh
set -e

# Server entrypoint - just starts the server
# Migrations and seeding should be run via Railway pre-deploy commands:
#   bun run /app/dist/migrate.mjs
#   bun run /app/dist/seed.mjs

echo "[entrypoint] Starting server..."
exec bun run /app/server/dist/index.mjs
