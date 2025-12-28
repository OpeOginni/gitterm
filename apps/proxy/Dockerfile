# =============================================================================
# PROXY - SUBDOMAIN ROUTING (Railway / Managed Deployment)
# =============================================================================
# Uses wildcard DNS (*.gitterm.dev) for subdomain-based workspace routing.
# This is the default for Railway deployments.
#
# For self-hosted/path-based routing, use Dockerfile.path instead.
# =============================================================================

FROM caddy:2-alpine

# Copy subdomain Caddyfile as the main config
COPY ./apps/proxy/Caddyfile.subdomain /etc/caddy/Caddyfile

# Copy error pages
COPY ./apps/proxy/errors /srv/errors

# Expose port 80 (Railway handles external TLS termination)
EXPOSE 80

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
