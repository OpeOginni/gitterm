#!/bin/sh
# =============================================================================
# Proxy Entrypoint Script
# =============================================================================
# Selects the appropriate Caddyfile based on ROUTING_MODE environment variable.
#
# Modes:
#   subdomain - Managed deployment with wildcard DNS (*.gitterm.dev)
#               Only routes workspace subdomains, not web/api/listener
#   railway   - Unified Railway template (all services behind one domain)
#               Routes web, api, listener, tunnel, and workspaces
#   path      - Path-based workspace routing only (legacy)
#               Only routes /ws/* paths, not web/api/listener
# =============================================================================

set -e

# Infer routing mode from DEPLOYMENT_MODE if not explicitly set
if [ -z "$ROUTING_MODE" ]; then
  if [ "$DEPLOYMENT_MODE" = "managed" ]; then
    ROUTING_MODE="subdomain"
  else
    # Self-hosted defaults to railway (unified) mode for simplicity
    ROUTING_MODE="railway"
  fi
fi

echo "=== GitTerm Proxy ==="
echo "Deployment mode: ${DEPLOYMENT_MODE:-not set}"
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
