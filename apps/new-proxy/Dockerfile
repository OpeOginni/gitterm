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

# Perform environment variable substitution as root (before switching user)
# This creates the final nginx.conf with substituted variables
RUN mkdir -p /etc/nginx/templates
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
RUN envsubst '$INTERNAL_API_KEY' < /etc/nginx/templates/default.conf.template > /etc/nginx/nginx.conf

# Switch to non-root user
USER nginx

# Expose port
EXPOSE 80

# Start nginx with the pre-substituted config
CMD ["nginx", "-g", "daemon off;"]

