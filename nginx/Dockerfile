FROM nginx:stable-alpine

WORKDIR /etc/nginx

COPY ./nginx.conf ./nginx.conf
COPY ./snippets /etc/nginx/snippets
COPY --chmod=755 ./40-validate-generated.sh /docker-entrypoint.d/40-validate-generated.sh

RUN mkdir -p /etc/nginx/locations

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s CMD wget -q -O /dev/null http://127.0.0.1:8081/healthz || exit 1
