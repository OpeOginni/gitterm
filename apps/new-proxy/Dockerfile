FROM caddy:2-alpine

# Copy all Caddyfile variants
COPY ./apps/new-proxy/Caddyfile /etc/caddy/Caddyfile
COPY ./apps/new-proxy/Caddyfile.subdomain /etc/caddy/Caddyfile.subdomain
COPY ./apps/new-proxy/Caddyfile.path /etc/caddy/Caddyfile.path

# Copy error pages
COPY ./apps/new-proxy/errors /srv/errors

# Copy entrypoint script
COPY ./apps/new-proxy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port 80 (Railway will handle external routing)
EXPOSE 80

# Use entrypoint script to select Caddyfile based on ROUTING_MODE
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
