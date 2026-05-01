FROM nginx:1.27-alpine

# Node.js is needed for the shared hot-state server
RUN apk add --no-cache nodejs

# Remove nginx's default site
RUN rm /etc/nginx/conf.d/default.conf

# nginx official image will envsubst every *.template file in this directory
# at container startup, writing the result to /etc/nginx/conf.d/.
# This is how EPICOR_URL and EPICOR_BASIC_AUTH from App Service env vars
# get injected into the proxy config without baking them into the image.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Static site
COPY public/ /usr/share/nginx/html/

# Hot-state server (no npm deps, pure Node stdlib)
COPY server.js /app/server.js

# The nginx official image runs scripts in /docker-entrypoint.d/ before starting nginx.
# Our script launches the hot server in the background first.
COPY docker-entrypoint.d/10-start-hot-server.sh /docker-entrypoint.d/10-start-hot-server.sh
RUN chmod +x /docker-entrypoint.d/10-start-hot-server.sh


EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/health || exit 1
