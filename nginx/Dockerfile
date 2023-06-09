FROM nginx:alpine

# Scripts

COPY ./entrypoint.sh /entrypoint.sh
COPY ./watch.sh /watch.sh

RUN mkdir -p /var/log/nginx/

RUN touch /var/log/nginx/access.log


# NGINX Setup

WORKDIR /etc/nginx

COPY ./nginx.conf ./nginx.conf
COPY ./snippets /etc/nginx/snippets

CMD []
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
