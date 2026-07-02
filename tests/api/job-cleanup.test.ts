import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatCleanupTerminalJobsSummary,
  readCleanupTerminalJobsCliOptions
} from "@/lib/jobs/cleanup-cli";

const scriptSource = readFileSync(join(process.cwd(), "scripts/jobs-cleanup.ts"), "utf8");
const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const deploymentReadiness = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");
const backgroundJobsDesign = readFileSync(join(process.cwd(), "docs/background-jobs-event-outbox-design.md"), "utf8");

describe("job cleanup command", () => {
  it("parses retention env vars conservatively", () => {
    expect(
      readCleanupTerminalJobsCliOptions({
        JOBS_RETAIN_DEAD_DAYS: "45",
        JOBS_RETAIN_SUCCEEDED_DAYS: "10"
      })
    ).toEqual({
      retainDeadDays: 45,
      retainSucceededDays: 10
    });
    expect(
      readCleanupTerminalJobsCliOptions({
        JOBS_RETAIN_DEAD_DAYS: "0",
        JOBS_RETAIN_SUCCEEDED_DAYS: "-1"
      })
    ).toEqual({
      retainDeadDays: undefined,
      retainSucceededDays: undefined
    });
    expect(
      readCleanupTerminalJobsCliOptions({
        JOBS_RETAIN_DEAD_DAYS: "abc",
        JOBS_RETAIN_SUCCEEDED_DAYS: "2.5"
      })
    ).toEqual({
      retainDeadDays: undefined,
      retainSucceededDays: undefined
    });
  });

  it("formats aggregate cleanup output only", () => {
    const output = formatCleanupTerminalJobsSummary({
      deadCutoff: new Date("2030-04-01T00:00:00.000Z"),
      deletedDead: 1,
      deletedSucceeded: 2,
      retainDeadDays: 30,
      retainSucceededDays: 7,
      succeededCutoff: new Date("2030-04-24T00:00:00.000Z"),
      totalDeleted: 3
    });

    expect(output).toContain("Job cleanup complete");
    expect(output).toContain("deletedSucceeded=2");
    expect(output).toContain("deletedDead=1");
    expect(output).toContain("totalDeleted=3");
    expect(output).not.toContain("payload");
    expect(output).not.toContain("resetUrl");
    expect(output).not.toContain("/reset-password");
    expect(output).not.toContain("token");
    expect(output).not.toContain("recipient@example.test");
    expect(output).not.toContain("dedupe");
    expect(output).not.toContain("lastError");
    expect(output).not.toContain("secret");
  });

  it("keeps the cleanup CLI aggregate-only", () => {
    expect(packageJson).toContain("\"jobs:cleanup\": \"tsx scripts/jobs-cleanup.ts\"");
    expect(scriptSource).toContain("cleanupTerminalJobs(readCleanupTerminalJobsCliOptions())");
    expect(scriptSource).toContain("formatCleanupTerminalJobsSummary(result)");
    expect(scriptSource).toContain("Job cleanup failed.");
    expect(scriptSource).not.toContain("job.payload");
    expect(scriptSource).not.toContain("payload");
    expect(scriptSource).not.toContain("resetUrl");
    expect(scriptSource).not.toContain("lastError");
    expect(scriptSource).not.toContain("error.message");
  });

  it("documents cleanup as terminal-only while retryable failures return to pending", () => {
    expect(deploymentReadiness).toContain(
      "It is not limited to active workspaces, so old terminal rows tied to deleted workspaces can still be pruned."
    );
    expect(deploymentReadiness).toContain(
      "It does not delete `PENDING` retryable jobs, `RUNNING` jobs, or non-terminal `FAILED` rows."
    );
    expect(deploymentReadiness).toContain(
      "Cleanup output is aggregate-only and does not print payloads, reset URLs, tokens, recipient emails, dedupe keys, `lastError`, or secrets."
    );
    expect(deploymentReadiness).toContain(
      "The status, run-once, continuous-worker, and cleanup commands print summary counts only and do not print payloads, reset URLs, tokens, recipient emails, or secrets."
    );
    expect(backgroundJobsDesign).toContain(
      "The current retry path requeues retryable failures as `PENDING` with a future `runAt`."
    );
    expect(backgroundJobsDesign).toContain(
      "including old terminal rows for deleted workspaces"
    );
    expect(backgroundJobsDesign).toContain(
      "It leaves `PENDING` retryable jobs, `RUNNING` jobs, and non-terminal `FAILED` rows untouched"
    );
  });
});
