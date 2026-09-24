#!/bin/sh
set -e

# Boot sequence for the server image. Each step is idempotent and safe to run
# on every start; each waits for Postgres and serializes with other replicas
# via an advisory lock.
#
# Opt out of individual steps (e.g. when running migrations as a separate
# CI/release job) by setting the variable to "true" or "1":
#   SKIP_MIGRATIONS  - skip applying SQL migrations
#   SKIP_SEED        - skip catalog seed (providers, agent types, images, ...)
#   SKIP_ADMIN_SEED  - skip ADMIN_EMAIL/ADMIN_PASSWORD bootstrap

is_true() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes) return 0 ;;
    *) return 1 ;;
  esac
}

if is_true "${SKIP_MIGRATIONS:-}"; then
  echo "[entrypoint] SKIP_MIGRATIONS set, skipping migrations"
else
  echo "[entrypoint] Running migrations..."
  (cd /app/packages/db && bun run db:migrate:prod)
fi

if is_true "${SKIP_SEED:-}"; then
  echo "[entrypoint] SKIP_SEED set, skipping seed"
else
  echo "[entrypoint] Running seed..."
  (cd /app/packages/db && bun run db:seed:prod)
fi

if is_true "${SKIP_ADMIN_SEED:-}"; then
  echo "[entrypoint] SKIP_ADMIN_SEED set, skipping admin seed"
else
  echo "[entrypoint] Running admin seed..."
  (cd /app/apps/server && bun run db:seed-admin:prod)
fi

echo "[entrypoint] Starting server..."
cd /app/apps/server
exec bun run dist/src/index.mjs
