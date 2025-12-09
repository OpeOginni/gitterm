FROM nginx:alpine

# Copy nginx template to the templates directory
# The nginx entrypoint will automatically process templates with envsubst (nginx 1.19+)
COPY ./apps/new-proxy/nginx.conf.template /etc/nginx/templates/default.conf.template

# Expose port
EXPOSE 80

# Use nginx's built-in entrypoint which automatically handles envsubst
# No need for custom entrypoint - it processes /etc/nginx/templates/*.template files

