# =============================================================================
# PROXY - UNIFIED DOCKERFILE
# =============================================================================
# Selects Caddyfile based on ROUTING_MODE environment variable:
#
#   ROUTING_MODE=subdomain  -> Caddyfile.subdomain (managed, wildcard DNS)
#   ROUTING_MODE=railway    -> Caddyfile.railway (unified, all services)
#   ROUTING_MODE=path       -> Caddyfile.path (workspace routing only)
#
# Default: subdomain (for backwards compatibility with managed deployment)
# =============================================================================

FROM caddy:2-alpine

# Copy all Caddyfiles
COPY ./apps/proxy/Caddyfile.subdomain /etc/caddy/Caddyfile.subdomain
COPY ./apps/proxy/Caddyfile.railway /etc/caddy/Caddyfile.railway
COPY ./apps/proxy/Caddyfile.path /etc/caddy/Caddyfile.path

# Copy error pages
COPY ./apps/proxy/errors /srv/errors

# Copy entrypoint script
COPY ./apps/proxy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port 80 (Railway handles external TLS termination)
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
