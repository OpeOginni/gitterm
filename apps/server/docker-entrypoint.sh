#!/bin/sh
set -e

# Server entrypoint - just starts the server
# Migrations and seeding should be run via Railway pre-deploy commands:
#   bun run /app/dist/migrate.mjs
#   bun run /app/dist/seed.mjs

echo "[entrypoint] Starting server..."

cd /packages/db
bun run db:migrate
bun run db:seed
bun run db:seed-admin

cd ..
cd ..
exec bun run /apps/server/dist/index.mjs
