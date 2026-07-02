import { spawn, type ChildProcessByStdio } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const packageManifest = JSON.parse(packageJson) as { scripts: Record<string, string> };
const railwayConfig = readFileSync(join(process.cwd(), "railway.json"), "utf8");
const railwayStartScript = readFileSync(join(process.cwd(), "scripts/railway-start.mjs"), "utf8");

type RailwayStartProcess = ChildProcessByStdio<null, Readable, Readable>;

describe("Railway service role startup", () => {
  it("uses a role-aware Railway start dispatcher", () => {
    expect(packageManifest.scripts["railway:start"]).toBe("node scripts/railway-start.mjs");
    expect(packageManifest.scripts.start).toBe("next start");
    expect(packageManifest.scripts["jobs:work"]).toBe("tsx scripts/jobs-work.ts");
    expect(railwayConfig).toContain("\"startCommand\": \"npm run railway:start\"");
  });

  it("runs the web app by default and the job worker when Railway service role is worker", () => {
    expect(railwayStartScript).toContain("RAILWAY_SERVICE_ROLE");
    expect(railwayStartScript).toContain("SERVICE_ROLE");
    expect(railwayStartScript).toContain("resolveServiceRole()");
    expect(railwayStartScript).toContain("[\"worker\", \"jobs\", \"job-worker\"]");
    expect(railwayStartScript).toContain("runCommand(\"npm\", [\"run\", \"jobs:work\"])");
    expect(railwayStartScript).toContain("runCommand(\"npm\", [\"run\", \"start\"])");
    expect(railwayStartScript).toContain("northstar-crm-worker");
    expect(railwayStartScript).toContain("\"cache-control\": \"no-store, max-age=0\"");
    expect(railwayStartScript).toContain("\"x-content-type-options\": \"nosniff\"");
    expect(railwayStartScript).not.toContain("RESEND_API_KEY");
    expect(railwayStartScript).not.toContain("DATABASE_URL");
  });

  it("executes the web start command by default", async () => {
    const harness = createRailwayStartHarness();

    try {
      const child = harness.spawnDispatcher();
      const result = await waitForProcess(child);

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(readFileSync(harness.logPath, "utf8")).toBe("run start\n");
      expect(result.stdout).toContain("Railway service role: web.");
      expect(result.stdout).not.toContain("DATABASE_URL");
      expect(result.stdout).not.toContain("RESEND_API_KEY");
      expect(result.stderr).toBe("");
    } finally {
      harness.cleanup();
    }
  });

  it("executes the worker command and exposes a minimal worker health response", async () => {
    const harness = createRailwayStartHarness();
    const port = await getAvailablePort();
    const child = harness.spawnDispatcher({
      PORT: String(port),
      RAILWAY_FAKE_NPM_STAY_ALIVE: "1",
      RAILWAY_SERVICE_ROLE: " JOB-WORKER "
    });

    try {
      const ready = waitForStdout(child, "Railway worker health check ready.");
      await ready;

      const response = await fetch(`http://127.0.0.1:${port}/api/health?probe=railway`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(body).toEqual({
        service: "northstar-crm-worker",
        status: "ok"
      });
      expect(Object.keys(body).sort()).toEqual(["service", "status"]);

      const missingResponse = await fetch(`http://127.0.0.1:${port}/not-health`);
      const missingBody = await missingResponse.json();

      expect(missingResponse.status).toBe(404);
      expect(missingResponse.headers.get("cache-control")).toBe("no-store, max-age=0");
      expect(missingBody).toEqual({ status: "not_found" });
      expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
      expect(JSON.stringify(missingBody)).not.toContain("RESEND_API_KEY");
      await waitForFileContent(harness.logPath, "run jobs:work\n");
      expect(readFileSync(harness.logPath, "utf8")).toBe("run jobs:work\n");
    } finally {
      child.kill("SIGTERM");
      await waitForProcess(child).catch(() => undefined);
      harness.cleanup();
    }
  });

  it("falls back to SERVICE_ROLE when Railway service role is blank", async () => {
    const harness = createRailwayStartHarness();

    try {
      const child = harness.spawnDispatcher({
        RAILWAY_SERVICE_ROLE: "   ",
        SERVICE_ROLE: " jobs "
      });
      const result = await waitForProcess(child);

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(readFileSync(harness.logPath, "utf8")).toBe("run jobs:work\n");
      expect(result.stdout).toContain("Railway service role: worker.");
      expect(result.stderr).toBe("");
    } finally {
      harness.cleanup();
    }
  });
});

function createRailwayStartHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), "northstar-railway-start-"));
  const logPath = join(tempDir, "npm-args.log");
  const fakeNpmPath = join(tempDir, "npm");

  writeFileSync(
    fakeNpmPath,
    `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.RAILWAY_FAKE_NPM_LOG, process.argv.slice(2).join(" ") + "\\n");
if (process.env.RAILWAY_FAKE_NPM_STAY_ALIVE === "1") {
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => undefined, 1000);
} else {
  process.exit(0);
}
`
  );
  chmodSync(fakeNpmPath, 0o755);

  return {
    cleanup() {
      rmSync(tempDir, { force: true, recursive: true });
    },
    logPath,
    spawnDispatcher(extraEnv: Partial<NodeJS.ProcessEnv> = {}) {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...extraEnv,
        PATH: `${tempDir}${delimiter}${process.env.PATH ?? ""}`,
        RAILWAY_FAKE_NPM_LOG: logPath
      };

      if (!("RAILWAY_SERVICE_ROLE" in extraEnv)) {
        delete env.RAILWAY_SERVICE_ROLE;
      }
      if (!("SERVICE_ROLE" in extraEnv)) {
        delete env.SERVICE_ROLE;
      }

      return spawn(process.execPath, ["scripts/railway-start.mjs"], {
        cwd: process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }
  };
}

function waitForProcess(child: RailwayStartProcess, timeoutMs = 5000) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Railway start dispatcher did not exit before timeout."));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function waitForStdout(child: RailwayStartProcess, text: string, timeoutMs = 5000) {
  return new Promise<void>((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for stdout: ${text}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes(text)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timeout);
      if (!stdout.includes(text)) {
        reject(new Error(`Process exited before stdout included: ${text}`));
      }
    });
  });
}

function waitForFileContent(filePath: string, expected: string, timeoutMs = 5000) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (existsSync(filePath) && readFileSync(filePath, "utf8") === expected) {
        clearInterval(interval);
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for ${filePath} to contain expected content.`));
      }
    }, 25);
  });
}

function getAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a local port.")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}
