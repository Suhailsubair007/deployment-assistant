# The assistant builds this itself when you answer "create a service" with this folder.
# Answer the health path question with /healthz: this app has no /health.
# To build it by hand:
#   docker build -t counter-app:v1 counter-app
FROM node:24-alpine

WORKDIR /app
COPY server.js .

ENV PORT=4000

# Do not run as root inside the container.
USER node
# The assistant reads this line to suggest the port.
EXPOSE 4000
CMD ["node", "server.js"]
