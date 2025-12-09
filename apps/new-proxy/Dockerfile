FROM nginx:alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Copy custom nginx configuration
COPY ./apps/new-proxy/nginx.conf.template /etc/nginx/templates/default.conf.template

# Create log directory with proper permissions
RUN mkdir -p /var/log/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid && \
    chown -R nginx:nginx /var/cache/nginx

# Switch to non-root user
USER nginx

# Expose port
EXPOSE 80

# Start nginx
CMD ["/bin/sh", "-c", "envsubst '$INTERNAL_API_KEY' < /etc/nginx/templates/default.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]

