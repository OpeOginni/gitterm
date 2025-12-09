FROM nginx:alpine

# Copy nginx template to the templates directory
# The nginx entrypoint will automatically process templates with envsubst (nginx 1.19+)

COPY ./apps/new-proxy/nginx.conf /etc/nginx/nginx.conf

# COPY ./nginx.conf /etc/nginx/nginx.conf

# Expose port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]