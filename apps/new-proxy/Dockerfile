FROM caddy:2-alpine

# Copy Caddyfile
COPY ./apps/new-proxy/Caddyfile /etc/caddy/Caddyfile

# Expose port 80 (Railway will handle external routing)
EXPOSE 80

# Caddy runs as non-root by default and auto-starts
# No need for explicit CMD, uses default: caddy run --config /etc/caddy/Caddyfile
