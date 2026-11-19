#!/usr/bin/env bash
set -euo pipefail

: "${GITTERM_IMAGE_TAG:?Set GITTERM_IMAGE_TAG to the platform candidate}"
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export INTERNAL_API_KEY="$(openssl rand -hex 24)"
export ENCRYPTION_MASTER_KEY="$(openssl rand -hex 32)"
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export WORKSPACE_JWT_SECRET="$(openssl rand -hex 32)"
export ADMIN_EMAIL=release-smoke@example.com
export ADMIN_PASSWORD="$(openssl rand -hex 24)"
export GITTERM_PORT=18888
export PUBLIC_HOST="localhost:$GITTERM_PORT"
export PUBLIC_URL="http://$PUBLIC_HOST"

scratch=$(mktemp -d)
compose=(docker compose -p "gitterm-release-smoke-$$" -f docker-compose.selfhost.yml)
cleanup() {
  local status=$?
  if (( status != 0 )); then
    "${compose[@]}" ps || true
    "${compose[@]}" logs --tail=80 || true
  fi
  "${compose[@]}" down --volumes
  rm -f "$scratch/cookies"
  rmdir "$scratch"
}
trap cleanup EXIT

"${compose[@]}" up -d --no-build --pull missing --wait --wait-timeout 180
curl -fsS --retry 20 --retry-delay 2 --retry-connrefused "$PUBLIC_URL/login" -o /dev/null
test "$(curl -fsS "$PUBLIC_URL/listener/health")" = "OK"
curl -fsS -c "$scratch/cookies" -H "Origin: $PUBLIC_URL" -H "Content-Type: application/json" \
  --data "$(jq -nc --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email:$email,password:$password}')" \
  "$PUBLIC_URL/api/auth/sign-in/email" | jq -e --arg email "$ADMIN_EMAIL" '.user.email == $email'
curl -fsS -b "$scratch/cookies" "$PUBLIC_URL/api/auth/get-session" |
  jq -e --arg email "$ADMIN_EMAIL" '.user.email == $email'
test "$(curl -fsS -b "$scratch/cookies" -o /dev/null -w '%{http_code}' "$PUBLIC_URL/dashboard")" = 200
"${compose[@]}" exec -T worker bun -e '
  const r = await fetch(process.env.SERVER_URL.replace(/\/api$/, "/"));
  if (!r.ok) process.exit(1);
'
