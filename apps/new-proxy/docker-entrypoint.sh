#!/bin/sh
set -e

# Select Caddyfile based on ROUTING_MODE environment variable
# Default: subdomain (for managed deployments with wildcard DNS)
# Option: path (for self-hosted without wildcard DNS)

ROUTING_MODE="${ROUTING_MODE:-subdomain}"

case "$ROUTING_MODE" in
  path)
    echo "Using path-based routing (Caddyfile.path)"
    cp /etc/caddy/Caddyfile.path /etc/caddy/Caddyfile
    ;;
  subdomain)
    echo "Using subdomain-based routing (Caddyfile.subdomain)"
    cp /etc/caddy/Caddyfile.subdomain /etc/caddy/Caddyfile
    ;;
  *)
    echo "Warning: Unknown ROUTING_MODE '$ROUTING_MODE', using subdomain (default)"
    cp /etc/caddy/Caddyfile.subdomain /etc/caddy/Caddyfile
    ;;
esac

# Execute the CMD
exec "$@"
