#!/bin/sh
set -eu

TARGET_DIR="/app/apps/web/.next"

replace_literal() {
  search="$1"
  value="$2"
  escaped_value=$(printf '%s' "$value" | sed 's/[&|\\]/\\&/g')
  escaped_search=$(printf '%s' "$search" | sed 's/[&|\\]/\\&/g')

  if [ -d "$TARGET_DIR" ]; then
    find "$TARGET_DIR" -type f \( -name "*.js" -o -name "*.html" -o -name "*.json" \) -exec \
      sed -i "s|${escaped_search}|${escaped_value}|g" {} +
  fi
}

replace_literal "http://build.localhost:8888/listener" "${NEXT_PUBLIC_LISTENER_URL:-http://localhost:8888/listener}"
replace_literal "http://build.localhost:8888/api" "${NEXT_PUBLIC_SERVER_URL:-http://localhost:8888/api}"
replace_literal "http://build.localhost:8888" "${NEXT_PUBLIC_AUTH_URL:-http://localhost:8888}"
replace_literal "build.localhost" "${NEXT_PUBLIC_BASE_DOMAIN:-localhost}"
replace_literal "__NEXT_PUBLIC_ENABLE_BILLING__" "${NEXT_PUBLIC_ENABLE_BILLING:-false}"
replace_literal "__NEXT_PUBLIC_ENABLE_EMAIL_AUTH__" "${NEXT_PUBLIC_ENABLE_EMAIL_AUTH:-false}"
replace_literal "__NEXT_PUBLIC_ENABLE_GITHUB_AUTH__" "${NEXT_PUBLIC_ENABLE_GITHUB_AUTH:-true}"
replace_literal "__NEXT_PUBLIC_ROUTING_MODE__" "${NEXT_PUBLIC_ROUTING_MODE:-path}"
replace_literal "__NEXT_PUBLIC_GITHUB_APP_NAME__" "${NEXT_PUBLIC_GITHUB_APP_NAME:-}"

exec "$@"
