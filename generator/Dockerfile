FROM node:18.3.0

CMD []

RUN apt-get update && apt-get install -y cron

WORKDIR /app

COPY package*.json ./

RUN npm i

COPY . .

RUN crontab crontab

RUN env >> /etc/environment

RUN touch /var/log/app.log

COPY ./entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
