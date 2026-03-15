#!/bin/sh
set -eu

TARGET_DIR="/app/apps/web/.next"

replace_placeholder() {
  var_name="$1"
  placeholder="__${var_name}__"
  value="${2}"
  escaped_value=$(printf '%s' "$value" | sed 's/[&|\\]/\\&/g')

  if [ -d "$TARGET_DIR" ]; then
    find "$TARGET_DIR" -type f \( -name "*.js" -o -name "*.html" -o -name "*.json" \) -exec \
      sed -i "s|${placeholder}|${escaped_value}|g" {} +
  fi
}

replace_placeholder "NEXT_PUBLIC_ENABLE_BILLING" "${NEXT_PUBLIC_ENABLE_BILLING:-false}"
replace_placeholder "NEXT_PUBLIC_ENABLE_EMAIL_AUTH" "${NEXT_PUBLIC_ENABLE_EMAIL_AUTH:-false}"
replace_placeholder "NEXT_PUBLIC_ENABLE_GITHUB_AUTH" "${NEXT_PUBLIC_ENABLE_GITHUB_AUTH:-true}"
replace_placeholder "NEXT_PUBLIC_BASE_DOMAIN" "${NEXT_PUBLIC_BASE_DOMAIN:-gitterm.dev}"
replace_placeholder "NEXT_PUBLIC_ROUTING_MODE" "${NEXT_PUBLIC_ROUTING_MODE:-path}"
replace_placeholder "NEXT_PUBLIC_SERVER_URL" "${NEXT_PUBLIC_SERVER_URL:-}"
replace_placeholder "NEXT_PUBLIC_LISTENER_URL" "${NEXT_PUBLIC_LISTENER_URL:-}"

exec "$@"
