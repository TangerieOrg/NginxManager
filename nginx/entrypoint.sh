[ -e "/etc/nginx/locations/generated.conf" ] && rm /etc/nginx/locations/generated.conf
nginx
echo "Tailing Log"
# tail -f /var/log/nginx/access.log
exec /watch.sh