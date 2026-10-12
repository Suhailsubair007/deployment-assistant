# Build one image per version:
#   docker build --build-arg APP_VERSION=v1 -t sample-app:v1 sample-app
#   docker build --build-arg APP_VERSION=v3 --build-arg CRASH_ON_START=true -t sample-app:v3 sample-app
FROM node:24-alpine

WORKDIR /app
COPY server.js .

ARG APP_VERSION=dev
ARG CRASH_ON_START=false
ENV APP_VERSION=${APP_VERSION} \
    CRASH_ON_START=${CRASH_ON_START} \
    PORT=8080

# Do not run as root inside the container.
USER node
EXPOSE 8080
# --expose-gc lets /stress give memory back as soon as its hold time is over.
CMD ["node", "--expose-gc", "server.js"]
