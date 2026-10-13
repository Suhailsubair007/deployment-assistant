# The assistant builds this itself when you answer "create a service" with this folder.
# To build it by hand:
#   docker build -t greeter-app:v1 greeter-app
FROM node:24-alpine

WORKDIR /app
COPY server.js .

ENV PORT=3000

# Do not run as root inside the container.
USER node
# The assistant reads this line to suggest the port.
EXPOSE 3000
CMD ["node", "server.js"]
