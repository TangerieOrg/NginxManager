cron -l 2
sleep 5
(cd /app && ./node_modules/.bin/ts-node -r tsconfig-paths/register ./src/index.ts)
cat /app/outputs/generated.conf
tail -f /var/log/app.log