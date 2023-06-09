SIGNAL_FILE=/etc/nginx/locations/signal

while true
do
    if [ -e "$SIGNAL_FILE" ]; then
        echo "Signal Detected"
        rm "$SIGNAL_FILE"
        nginx -s reload
    fi
    sleep 10;
done