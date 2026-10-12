// A tiny web app used to test the Deployment Assistant. It has no dependencies.
//
//   GET /health                               -> 200 {"status":"ok","version":"v1"}
//   GET /stress?cpu=30                        -> uses CPU for 30 seconds
//   GET /stress?memory=150&hold=120           -> holds 150 Mi of memory for 120 seconds
//
// The broken image (v3) is built with CRASH_ON_START=true and exits straight away.

const http = require("node:http");

const VERSION = process.env.APP_VERSION || "dev";
const PORT = Number(process.env.PORT || 8080);

const MAX_CPU_SECONDS = 300;
const MAX_MEMORY_MI = 2048;
const DEFAULT_HOLD_SECONDS = 60;
const MI = 1024 * 1024;

if (process.env.CRASH_ON_START === "true") {
  console.error("Fatal: cannot read /etc/app/config.json");
  process.exit(1);
}

/**
 * Uses CPU for the given time in short bursts. Between bursts Node gets a moment
 * to answer other requests, so /health keeps working while the CPU is busy.
 */
function burnCpu(seconds) {
  const stopAt = Date.now() + seconds * 1000;
  function burst() {
    const burstEnd = Date.now() + 50;
    while (Date.now() < burstEnd) {
      Math.sqrt(Math.random());
    }
    if (Date.now() < stopAt) {
      setImmediate(burst);
    }
  }
  burst();
}

/** Allocates memory and keeps it until the hold time is over. */
function holdMemory(megabytes, holdSeconds) {
  // Filling the buffer makes the operating system really hand over the memory.
  let block = Buffer.alloc(megabytes * MI, 1);
  setTimeout(() => {
    block = null;
    // Node frees memory only when its garbage collector runs, and an idle app may not
    // run it for a long time. Ask for it now, so the usage really drops after the hold.
    if (global.gc) {
      global.gc();
    }
    console.log(`Released ${megabytes} Mi`);
  }, holdSeconds * 1000);
}

/** Reads a whole number from the query string, or returns 0 when it is missing or invalid. */
function readAmount(query, name, max) {
  const value = Number(query.get(name));
  if (!Number.isInteger(value) || value <= 0) {
    return 0;
  }
  return Math.min(value, max);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", version: VERSION });
    return;
  }

  if (url.pathname === "/stress") {
    const cpuSeconds = readAmount(url.searchParams, "cpu", MAX_CPU_SECONDS);
    const memoryMi = readAmount(url.searchParams, "memory", MAX_MEMORY_MI);
    const holdSeconds = readAmount(url.searchParams, "hold", 3600) || DEFAULT_HOLD_SECONDS;
    if (cpuSeconds === 0 && memoryMi === 0) {
      sendJson(response, 400, { error: "Use /stress?cpu=<seconds> or /stress?memory=<Mi>&hold=<seconds>" });
      return;
    }
    console.log(`Stress requested: cpu=${cpuSeconds}s memory=${memoryMi}Mi hold=${holdSeconds}s`);
    if (cpuSeconds > 0) {
      burnCpu(cpuSeconds);
    }
    if (memoryMi > 0) {
      holdMemory(memoryMi, holdSeconds);
    }
    sendJson(response, 202, { version: VERSION, cpuSeconds, memoryMi, holdSeconds });
    return;
  }

  if (url.pathname === "/") {
    sendJson(response, 200, { app: "sample-app", version: VERSION });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`sample-app ${VERSION} listening on port ${PORT}`);
});

// Kubernetes sends SIGTERM before it removes a pod. Finish open requests, then exit.
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  server.close(() => process.exit(0));
});
