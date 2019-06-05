FROM node:8-alpine
LABEL maintainer="Torsten Dreyer <torsten@t3r.de>"
LABEL version="1.1.0"
LABEL description="FlightGear scenemodels API"

RUN apk add --no-cache curl

EXPOSE 3001
ENV node_env production
ENV PGHOST 127.0.0.1
ENV PGPORT 5432
ENV PGDATABASE scenemodels
ENV PGUSER webuser
ENV PGPASSWORD secret

WORKDIR /usr/local/app
COPY package.json package-lock.json /usr/local/app/
RUN npm install --only=production
COPY . /usr/local/app/

USER nobody
# Command
CMD ["node", "server.js" ]

