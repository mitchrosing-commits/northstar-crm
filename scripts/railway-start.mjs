import { spawn } from "node:child_process";
import { createServer } from "node:http";

const role = resolveServiceRole();
const isWorkerRole = ["worker", "jobs", "job-worker"].includes(role);
const child = isWorkerRole ? runCommand("npm", ["run", "jobs:work"]) : runCommand("npm", ["run", "start"]);
const healthServer = isWorkerRole ? startWorkerHealthServer() : null;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child.kill(signal);
  });
}

child.once("exit", (code, signal) => {
  healthServer?.close();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

child.once("error", () => {
  healthServer?.close();
  process.exitCode = 1;
});

function runCommand(command, args) {
  console.log(isWorkerRole ? "Railway service role: worker." : "Railway service role: web.");
  return spawn(command, args, {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });
}

function resolveServiceRole() {
  for (const value of [process.env.RAILWAY_SERVICE_ROLE, process.env.SERVICE_ROLE]) {
    const role = value?.trim().toLowerCase();
    if (role) return role;
  }

  return "web";
}

function startWorkerHealthServer() {
  const port = Number.parseInt(process.env.PORT ?? "", 10);
  if (!Number.isInteger(port) || port <= 0) return null;

  const server = createServer((request, response) => {
    if ((request.url ?? "").split("?")[0] !== "/api/health") {
      response.writeHead(404, workerHealthHeaders());
      response.end(JSON.stringify({ status: "not_found" }));
      return;
    }

    response.writeHead(200, workerHealthHeaders());
    response.end(JSON.stringify({ service: "northstar-crm-worker", status: "ok" }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log("Railway worker health check ready.");
  });

  return server;
}

function workerHealthHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    "content-type": "application/json",
    "x-content-type-options": "nosniff"
  };
}
