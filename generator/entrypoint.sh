(cd /app && ./node_modules/.bin/ts-node -r tsconfig-paths/register ./src/index.ts)
cron -l 2
echo "Tailing Log"
tail -f /var/log/app.log