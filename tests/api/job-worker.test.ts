import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { internalNoopJobType, jobHandlers, passwordResetEmailJobType } from "@/lib/jobs/handlers";
import { formatRunJobsOnceSummary, readRunJobsOnceCliOptions } from "@/lib/jobs/run-once-cli";
import { defaultRunOnceWorkerId, normalizeRunOnceWorkerId } from "@/lib/jobs/run-once";
import { readRunJobsWorkerCliOptions } from "@/lib/jobs/work-cli";
import {
  defaultJobsStaleAfterMs,
  defaultJobsWorkerPollIntervalMs,
  formatRunJobsWorkerSummary,
  formatStaleRecoverySummary,
  normalizeJobsWorkerId,
  normalizePollIntervalMs,
  normalizeStaleAfterMs
} from "@/lib/jobs/work";

const runOnceSource = readFileSync(join(process.cwd(), "lib/jobs/run-once.ts"), "utf8");
const handlersSource = readFileSync(join(process.cwd(), "lib/jobs/handlers.ts"), "utf8");
const scriptSource = readFileSync(join(process.cwd(), "scripts/jobs-run-once.ts"), "utf8");
const workScriptSource = readFileSync(join(process.cwd(), "scripts/jobs-work.ts"), "utf8");
const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");

describe("single-run job worker shell", () => {
  it("keeps the handler registry explicit and limited to intended job types", () => {
    expect(internalNoopJobType).toBe("internal.noop");
    expect(passwordResetEmailJobType).toBe("auth.password_reset_email");
    expect(Object.keys(jobHandlers)).toEqual([internalNoopJobType, passwordResetEmailJobType]);
    expect(handlersSource).not.toContain("import(");
    expect(handlersSource).not.toContain("payload.type");
  });

  it("normalizes worker ids without secrets or random values", () => {
    expect(defaultRunOnceWorkerId(1234)).toBe("jobs-run-once-1234");
    expect(normalizeRunOnceWorkerId(undefined, 1234)).toBe("jobs-run-once-1234");
    expect(normalizeRunOnceWorkerId("  worker-a  ", 1234)).toBe("worker-a");
    expect(normalizeRunOnceWorkerId("   ", 1234)).toBe("jobs-run-once-1234");
    expect(normalizeJobsWorkerId(undefined, 1234)).toBe("jobs-work-1234");
    expect(normalizeJobsWorkerId("  worker-b  ", 1234)).toBe("worker-b");
  });

  it("parses CLI options conservatively and defaults invalid batch sizes safely", () => {
    expect(readRunJobsOnceCliOptions({ JOB_WORKER_ID: "worker-a", JOBS_BATCH_SIZE: "5" })).toEqual({
      workerId: "worker-a",
      limit: 5
    });
    expect(readRunJobsOnceCliOptions({ JOB_WORKER_ID: "worker-a", JOBS_BATCH_SIZE: "0" })).toEqual({
      workerId: "worker-a",
      limit: undefined
    });
    expect(readRunJobsOnceCliOptions({ JOB_WORKER_ID: "worker-a", JOBS_BATCH_SIZE: "2abc" })).toEqual({
      workerId: "worker-a",
      limit: undefined
    });
    expect(readRunJobsOnceCliOptions({ JOBS_BATCH_SIZE: "-1" })).toEqual({
      workerId: undefined,
      limit: undefined
    });
    expect(
      readRunJobsWorkerCliOptions({
        JOBS_BATCH_SIZE: "3",
        JOBS_IDLE_EXIT_AFTER_MS: "10",
        JOBS_POLL_INTERVAL_MS: "25",
        JOBS_STALE_AFTER_MS: "90000",
        JOB_WORKER_ID: "worker-loop"
      })
    ).toEqual({
      idleExitAfterMs: 10,
      limit: 3,
      pollIntervalMs: 25,
      staleAfterMs: 90000,
      workerId: "worker-loop"
    });
    expect(
      readRunJobsWorkerCliOptions({
        JOBS_BATCH_SIZE: "0",
        JOBS_IDLE_EXIT_AFTER_MS: "-1",
        JOBS_POLL_INTERVAL_MS: "0",
        JOBS_STALE_AFTER_MS: "-1000",
        JOB_WORKER_ID: "worker-loop"
      })
    ).toEqual({
      idleExitAfterMs: undefined,
      limit: undefined,
      pollIntervalMs: undefined,
      staleAfterMs: undefined,
      workerId: "worker-loop"
    });
    expect(normalizePollIntervalMs(undefined)).toBe(defaultJobsWorkerPollIntervalMs);
    expect(normalizePollIntervalMs(0)).toBe(defaultJobsWorkerPollIntervalMs);
    expect(normalizePollIntervalMs(-1)).toBe(defaultJobsWorkerPollIntervalMs);
    expect(normalizePollIntervalMs(25)).toBe(25);
    expect(normalizeStaleAfterMs(undefined)).toBe(defaultJobsStaleAfterMs);
    expect(normalizeStaleAfterMs(0)).toBe(defaultJobsStaleAfterMs);
    expect(normalizeStaleAfterMs(-1)).toBe(defaultJobsStaleAfterMs);
    expect(normalizeStaleAfterMs(90000)).toBe(90000);
  });

  it("formats CLI output as summary counts only", () => {
    const summary = formatRunJobsOnceSummary({ claimed: 2, succeeded: 1, failed: 0, dead: 1 });
    const workerSummary = formatRunJobsWorkerSummary({
      batches: 2,
      claimed: 2,
      recovered: 0,
      succeeded: 1,
      failed: 0,
      dead: 1,
      stopped: false
    });
    const recoverySummary = formatStaleRecoverySummary({
      cutoff: new Date("2030-03-01T11:45:00.000Z"),
      recovered: 1,
      runAt: new Date("2030-03-01T12:00:00.000Z"),
      staleAfterMs: 900000
    });

    expect(summary).toBe("Processed one job batch: claimed=2 succeeded=1 failed=0 dead=1");
    expect(workerSummary).toBe("Job worker stopped: batches=2 recovered=0 claimed=2 succeeded=1 failed=0 dead=1");
    expect(recoverySummary).toBe("Recovered stale running jobs: recovered=1");
    expect(summary).not.toContain("payload");
    expect(workerSummary).not.toContain("payload");
    expect(recoverySummary).not.toContain("payload");
    expect(summary).not.toContain("resetUrl");
    expect(workerSummary).not.toContain("resetUrl");
    expect(recoverySummary).not.toContain("resetUrl");
    expect(summary).not.toContain("to=");
    expect(workerSummary).not.toContain("to=");
    expect(recoverySummary).not.toContain("to=");
    expect(summary).not.toContain("token");
    expect(workerSummary).not.toContain("token");
    expect(recoverySummary).not.toContain("token");
    expect(summary).not.toContain("reset");
    expect(workerSummary).not.toContain("reset");
    expect(recoverySummary).not.toContain("reset");
  });

  it("keeps the script single-run and summary-only", () => {
    expect(scriptSource).toContain("runJobsOnce(readRunJobsOnceCliOptions())");
    expect(scriptSource).toContain("formatRunJobsOnceSummary(result)");
    expect(scriptSource).not.toContain("setInterval");
    expect(scriptSource).not.toContain("while (true)");
    expect(scriptSource).not.toContain("job.payload");
    expect(scriptSource).not.toContain("error.message");
    expect(runOnceSource).not.toContain("setInterval");
    expect(runOnceSource).not.toContain("while (true)");
    expect(packageJson).toContain("\"jobs:work\": \"tsx scripts/jobs-work.ts\"");
    expect(workScriptSource).toContain("runJobsWorker");
    expect(workScriptSource).toContain("formatStaleRecoverySummary");
    expect(workScriptSource).toContain("SIGINT");
    expect(workScriptSource).toContain("SIGTERM");
    expect(workScriptSource).not.toContain("job.payload");
    expect(workScriptSource).not.toContain("resetUrl");
    expect(workScriptSource).not.toContain("lastError");
    expect(workScriptSource).not.toContain("error.message");
  });
});
