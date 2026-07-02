import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  internalNoopJobType,
  jobHandlers,
  parsePasswordResetEmailJobPayload,
  passwordResetEmailJobType
} from "@/lib/jobs/handlers";
import { formatRunJobsOnceSummary, readRunJobsOnceCliOptions } from "@/lib/jobs/run-once-cli";
import { defaultRunOnceWorkerId, normalizeRunOnceWorkerId } from "@/lib/jobs/run-once";
import { readRunJobsWorkerCliOptions } from "@/lib/jobs/work-cli";
import {
  defaultJobsStaleAfterMs,
  defaultJobsWorkerPollIntervalMs,
  formatRunJobsWorkerBatchSummary,
  formatRunJobsWorkerSummary,
  formatStaleRecoverySummary,
  normalizeJobsWorkerId,
  normalizePollIntervalMs,
  normalizeStaleAfterMs
} from "@/lib/jobs/work";

const runOnceSource = readFileSync(join(process.cwd(), "lib/jobs/run-once.ts"), "utf8");
const handlersSource = readFileSync(join(process.cwd(), "lib/jobs/handlers.ts"), "utf8");
const jobServiceSource = readFileSync(join(process.cwd(), "lib/services/job-service.ts"), "utf8");
const productLimitsSource = readFileSync(join(process.cwd(), "lib/product-limits.ts"), "utf8");
const backgroundJobsDesignSource = readFileSync(join(process.cwd(), "docs/background-jobs-event-outbox-design.md"), "utf8");
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

  it("parses queued password reset email payloads without leaking rejected values", () => {
    expect(
      parsePasswordResetEmailJobPayload({
        expiresAt: " 2030-03-02T13:40:00.000Z ",
        resetUrl: " https://crm.example.test/reset-password?token=safe-reset-token ",
        to: " founder@example.test "
      })
    ).toEqual({
      expiresAt: new Date("2030-03-02T13:40:00.000Z"),
      resetUrl: "https://crm.example.test/reset-password?token=safe-reset-token",
      to: "founder@example.test"
    });

    for (const payload of [
      null,
      [],
      {},
      {
        expiresAt: "2030-03-02T13:40:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=secret-reset-token",
        to: "not-an-email"
      },
      {
        expiresAt: "not-a-date",
        resetUrl: "https://crm.example.test/reset-password?token=secret-reset-token",
        to: "founder@example.test"
      }
    ]) {
      expect(() => parsePasswordResetEmailJobPayload(payload)).toThrow(
        "Invalid password reset email job payload."
      );
    }

    try {
      parsePasswordResetEmailJobPayload({
        expiresAt: "not-a-date",
        resetUrl: "https://crm.example.test/reset-password?token=secret-reset-token",
        to: "founder@example.test"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Invalid password reset email job payload.");
      expect(message).not.toContain("secret-reset-token");
      expect(message).not.toContain("founder@example.test");
    }
  });

  it("validates job maxAttempts against integer storage limits before enqueue", () => {
    expect(productLimitsSource).toContain("jobMaxAttemptsMax = intColumnMax");
    expect(jobServiceSource).toContain("jobMaxAttemptsMax");
    expect(jobServiceSource).toContain("function normalizeEnqueueInput(input: unknown)");
    expect(jobServiceSource).toContain("const jobInput = objectInput(input)");
    expect(jobServiceSource).toContain("function objectInput(input: unknown): Record<string, unknown>");
    expect(jobServiceSource).toContain("function normalizeJobType(value: unknown)");
    expect(jobServiceSource).toContain("function normalizeJobPayload(value: unknown)");
    expect(jobServiceSource).toContain("function normalizeOptionalJobWorkspaceId(value: unknown)");
    expect(jobServiceSource).toContain("function normalizeOptionalJobDate(value: unknown");
    expect(jobServiceSource).toContain("function normalizeClaimLimit(limit: unknown)");
    expect(jobServiceSource).toContain("activeJobWorkspaceWhere()");
    expect(jobServiceSource).toContain("return { OR: [{ workspaceId: null }, { workspace: { deletedAt: null } }] };");
    expect(jobServiceSource).toContain("Job maxAttempts is too large.");
    expect(jobServiceSource).toContain("Job payload must be JSON-compatible.");
    expect(jobServiceSource).toContain("Job type must use lowercase letters, numbers, dots, underscores, or hyphens.");
    expect(jobServiceSource).toContain("Job type is too large.");
    expect(jobServiceSource).toContain("Job workspace id must be text.");
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

  it("documents the implemented continuous-worker environment variables", () => {
    expect(backgroundJobsDesignSource).toContain("JOBS_STALE_AFTER_MS");
    expect(backgroundJobsDesignSource).toContain("JOBS_POLL_INTERVAL_MS");
    expect(backgroundJobsDesignSource).toContain("JOBS_IDLE_EXIT_AFTER_MS");
    expect(backgroundJobsDesignSource).not.toContain("JOBS_STALE_RUNNING_TIMEOUT_MS");
  });

  it("formats CLI output as summary counts only", () => {
    const summary = formatRunJobsOnceSummary({ claimed: 2, succeeded: 1, failed: 0, dead: 1 });
    const batchSummary = formatRunJobsWorkerBatchSummary({ claimed: 2, succeeded: 1, failed: 0, dead: 1 });
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
      dead: 1,
      recovered: 1,
      runAt: new Date("2030-03-01T12:00:00.000Z"),
      staleAfterMs: 900000
    });
    const deadOnlyRecoverySummary = formatStaleRecoverySummary({
      cutoff: new Date("2030-03-01T11:45:00.000Z"),
      dead: 1,
      recovered: 0,
      runAt: new Date("2030-03-01T12:00:00.000Z"),
      staleAfterMs: 900000
    });

    expect(summary).toBe("Processed one job batch: claimed=2 succeeded=1 failed=0 dead=1");
    expect(batchSummary).toBe("Processed one job batch: claimed=2 succeeded=1 failed=0 dead=1");
    expect(workerSummary).toBe("Job worker stopped: batches=2 recovered=0 claimed=2 succeeded=1 failed=0 dead=1");
    expect(recoverySummary).toBe("Recovered stale running jobs: recovered=1 dead=1");
    expect(deadOnlyRecoverySummary).toBe("Recovered stale running jobs: recovered=0 dead=1");
    expect(summary).not.toContain("payload");
    expect(batchSummary).not.toContain("payload");
    expect(workerSummary).not.toContain("payload");
    expect(recoverySummary).not.toContain("payload");
    expect(deadOnlyRecoverySummary).not.toContain("payload");
    expect(summary).not.toContain("lastError");
    expect(batchSummary).not.toContain("lastError");
    expect(workerSummary).not.toContain("lastError");
    expect(recoverySummary).not.toContain("lastError");
    expect(deadOnlyRecoverySummary).not.toContain("lastError");
    expect(summary).not.toContain("resetUrl");
    expect(batchSummary).not.toContain("resetUrl");
    expect(workerSummary).not.toContain("resetUrl");
    expect(recoverySummary).not.toContain("resetUrl");
    expect(deadOnlyRecoverySummary).not.toContain("resetUrl");
    expect(summary).not.toContain("recipient@example.test");
    expect(batchSummary).not.toContain("recipient@example.test");
    expect(workerSummary).not.toContain("recipient@example.test");
    expect(recoverySummary).not.toContain("recipient@example.test");
    expect(deadOnlyRecoverySummary).not.toContain("recipient@example.test");
    expect(summary).not.toContain("to=");
    expect(batchSummary).not.toContain("to=");
    expect(workerSummary).not.toContain("to=");
    expect(recoverySummary).not.toContain("to=");
    expect(deadOnlyRecoverySummary).not.toContain("to=");
    expect(summary).not.toContain("token");
    expect(batchSummary).not.toContain("token");
    expect(workerSummary).not.toContain("token");
    expect(recoverySummary).not.toContain("token");
    expect(deadOnlyRecoverySummary).not.toContain("token");
    expect(summary).not.toContain("reset");
    expect(batchSummary).not.toContain("reset");
    expect(workerSummary).not.toContain("reset");
    expect(recoverySummary).not.toContain("reset");
    expect(deadOnlyRecoverySummary).not.toContain("reset");
    expect(summary).not.toContain("secret");
    expect(batchSummary).not.toContain("secret");
    expect(workerSummary).not.toContain("secret");
    expect(recoverySummary).not.toContain("secret");
    expect(deadOnlyRecoverySummary).not.toContain("secret");
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
    expect(runOnceSource).toContain("No job handler registered.");
    expect(runOnceSource).not.toContain("No job handler registered for type");
    expect(packageJson).toContain("\"jobs:work\": \"tsx scripts/jobs-work.ts\"");
    expect(workScriptSource).toContain("runJobsWorker");
    expect(workScriptSource).toContain("formatStaleRecoverySummary");
    expect(workScriptSource).toContain("recovery.recovered > 0 || recovery.dead > 0");
    expect(workScriptSource).toContain("SIGINT");
    expect(workScriptSource).toContain("SIGTERM");
    expect(workScriptSource).not.toContain("job.payload");
    expect(workScriptSource).not.toContain("resetUrl");
    expect(workScriptSource).not.toContain("lastError");
    expect(workScriptSource).not.toContain("error.message");
  });
});
