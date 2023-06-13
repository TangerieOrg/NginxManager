[ -e "/etc/nginx/locations/generated.conf" ] && rm /etc/nginx/locations/generated.conf
nginx
sleep 10
echo "Reloading before start"
nginx -t
nginx -s reload
[ -e "/etc/nginx/locations/generated.conf" ] && cat /etc/nginx/locations/generated.conf
exec /watch.sh