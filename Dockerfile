FROM nginx:1.27-alpine

# Remove nginx's default site
RUN rm /etc/nginx/conf.d/default.conf

# nginx official image will envsubst every *.template file in this directory
# at container startup, writing the result to /etc/nginx/conf.d/.
# This is how EPICOR_URL and EPICOR_BASIC_AUTH from App Service env vars
# get injected into the proxy config without baking them into the image.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Static site
COPY public/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/health || exit 1
