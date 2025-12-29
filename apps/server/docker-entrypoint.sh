#!/bin/sh
set -e

# NOTE:
# We intentionally do NOT run migrations/seeding automatically on container startup.
# - For managed platforms (e.g. Railway), run migrations in a pre-deploy step.
# - For self-hosted Docker, run these as one-off commands when you choose.
#
# Available bundled scripts inside this image:
#   bun run /app/dist/migrate.mjs
#   bun run /app/dist/seed.mjs
#
# Optional (manual) behavior:
#   RUN_MIGRATIONS=true  -> runs migrate script before starting
#   RUN_SEED=true        -> runs seed script before starting

if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "[entrypoint] RUN_MIGRATIONS=true - running database migrations..."
    bun run /app/dist/migrate.mjs
fi

if [ "$RUN_SEED" = "true" ]; then
    echo "[entrypoint] RUN_SEED=true - running database seed..."
    bun run /app/dist/seed.mjs
fi

# Start the server
echo "[entrypoint] Starting server..."
exec bun run /app/dist/index.mjs
