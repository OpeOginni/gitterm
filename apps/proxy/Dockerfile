# =============================================================================
# PROXY - Unified Railway Routing
# =============================================================================
# All services behind a single domain - no cross-origin issues.
#
# URL Structure:
# - /*              -> Web app (Next.js) - DEFAULT
# - /api/*          -> API server
# - /listener/*     -> Listener (SSE/tRPC)
# - /tunnel/*       -> Tunnel-proxy (agent WebSocket connections)
# - /ws/{subdomain}/* -> Workspace traffic (path-based routing)
#
# Environment Variables:
# - WEB_URL         -> e.g., web.railway.internal:8080
# - SERVER_URL      -> e.g., server.railway.internal:8080
# - LISTENER_URL    -> e.g., listener.railway.internal:8080
# - TUNNEL_PROXY_URL -> e.g., tunnel.railway.internal:8080
# - INTERNAL_API_KEY -> Shared key for internal API calls
# =============================================================================

FROM caddy:2-alpine

# Copy the railway Caddyfile
COPY ./apps/proxy/Caddyfile.railway /etc/caddy/Caddyfile

# Copy error pages
COPY ./apps/proxy/errors /srv/errors

# Expose port 80 (Railway handles external TLS termination)
EXPOSE 80

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
