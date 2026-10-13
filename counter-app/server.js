// A third tiny web app, for trying "create a service" in the Deployment Assistant.
// It has no dependencies. It differs from the other two in what the chat's questions
// have to be told: it listens on port 4000, and its health check is on /healthz, not /health.
//
//   GET /healthz  -> 200 {"status":"ok"}
//   GET /         -> 200 "Visit 3 to counter-app-5d9c7-abcde"
//
// The count is kept in memory, so every copy (pod) counts by itself. With two copies
// running, two requests can give "Visit 1" twice: each landed on another pod.

const http = require("node:http");
const os = require("node:os");

const PORT = Number(process.env.PORT || 4000);
// Inside Kubernetes the host name is the name of the pod.
const POD = os.hostname();

let visits = 0;

const server = http.createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.url === "/") {
    visits += 1;
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(`Visit ${visits} to ${POD}\n`);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found\n");
});

server.listen(PORT, () => {
  console.log(`counter-app listening on port ${PORT}`);
});

// Kubernetes sends SIGTERM before it removes a pod. Finish open requests, then stop.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
