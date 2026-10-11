#!/bin/sh
# A bad generated.conf shouldn't stop nginx starting, the generator rewrites it
if [ -e /etc/nginx/locations/generated.conf ] && ! nginx -t -q; then
    echo "Invalid generated.conf, moving to generated.conf.bad"
    mv /etc/nginx/locations/generated.conf /etc/nginx/locations/generated.conf.bad
fi
