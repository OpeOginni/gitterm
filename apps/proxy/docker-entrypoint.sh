#!/bin/sh
# =============================================================================
# Proxy Entrypoint Script
# =============================================================================
# Selects the appropriate Caddyfile based on ROUTING_MODE environment variable.
# =============================================================================

set -e

# Default to subdomain mode for backwards compatibility
ROUTING_MODE="${ROUTING_MODE:-subdomain}"

echo "=== GitTerm Proxy ==="
echo "Routing mode: $ROUTING_MODE"

case "$ROUTING_MODE" in
  subdomain)
    echo "Using Caddyfile.subdomain (managed deployment with wildcard DNS)"
    cp /etc/caddy/Caddyfile.subdomain /etc/caddy/Caddyfile
    ;;
  railway)
    echo "Using Caddyfile.railway (unified routing for Railway template)"
    cp /etc/caddy/Caddyfile.railway /etc/caddy/Caddyfile
    ;;
  path)
    echo "Using Caddyfile.path (path-based workspace routing only)"
    cp /etc/caddy/Caddyfile.path /etc/caddy/Caddyfile
    ;;
  *)
    echo "ERROR: Unknown ROUTING_MODE: $ROUTING_MODE"
    echo "Valid options: subdomain, railway, path"
    exit 1
    ;;
esac

echo "Starting Caddy..."
exec "$@"
