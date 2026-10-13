// A second tiny web app, for trying "create a service" in the Deployment Assistant.
// It has no dependencies. It differs from sample-app in two ways that the chat's
// questions pick up: it listens on port 3000, and it reads a variable.
//
//   GET /health   -> 200 {"status":"ok"}
//   GET /         -> 200 "Hello from greeter-app"   (the first word is the GREETING variable)

const http = require("node:http");

const PORT = Number(process.env.PORT || 3000);
// Set from the chat: answer the variables question with GREETING=Namaste
const GREETING = process.env.GREETING || "Hello";

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(`${GREETING} from greeter-app\n`);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found\n");
});

server.listen(PORT, () => {
  console.log(`greeter-app listening on port ${PORT}, greeting: ${GREETING}`);
});

// Kubernetes sends SIGTERM before it removes a pod. Finish open requests, then stop.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
