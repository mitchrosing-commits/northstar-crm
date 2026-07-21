import { JobStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { formatJobQueueStatus } from "@/lib/jobs/status-cli";
import {
  gmailInboxSyncJobType,
  internalNoopJobType,
  meetingMediaExtractionJobType,
  passwordResetEmailJobType,
  workspaceInvitationEmailJobType
} from "@/lib/jobs/handlers";
import type { JobQueueStatus } from "@/lib/services/job-service";

const scriptSource = readFileSync(join(process.cwd(), "scripts/jobs-status.ts"), "utf8");
const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const deploymentReadinessSource = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");

describe("job queue status command", () => {
  it("formats aggregate status only without sensitive payload fields", () => {
    const output = formatJobQueueStatus({
      total: 3,
      byStatus: {
        [JobStatus.PENDING]: 1,
        [JobStatus.RUNNING]: 1,
        [JobStatus.SUCCEEDED]: 0,
        [JobStatus.FAILED]: 0,
        [JobStatus.DEAD]: 1
      },
      duePendingCount: 1,
      futurePendingCount: 0,
      oldestDuePendingRunAt: new Date("2030-04-01T00:00:00.000Z"),
      typeCounts: [
        { type: passwordResetEmailJobType, count: 2 },
        { type: internalNoopJobType, count: 1 },
        { type: gmailInboxSyncJobType, count: 6 },
        { type: meetingMediaExtractionJobType, count: 7 },
        { type: workspaceInvitationEmailJobType, count: 8 },
        { type: "AUTH.PASSWORD_RESET_EMAIL", count: 3 },
        { type: "auth.password_reset_email.", count: 4 },
        { type: "internal.noop ", count: 5 },
        { type: "recipient@example.test", count: 1 },
        { type: "reset-token-secret", count: 1 }
      ]
    } satisfies JobQueueStatus);

    expect(output).toContain("Job queue status");
    expect(output).toContain("pending=1");
    expect(output).toContain("oldestDuePendingRunAt=2030-04-01T00:00:00.000Z");
    expect(output).toContain("auth.password_reset_email=2");
    expect(output).toContain("internal.noop=1");
    expect(output).toContain("email.gmail_sync=6");
    expect(output).toContain("meeting_intake.extract_media=7");
    expect(output).toContain("workspace.invitation_email=8");
    expect(output).toContain("unregistered=14");
    expect(output).not.toContain("AUTH.PASSWORD_RESET_EMAIL");
    expect(output).not.toContain("auth.password_reset_email.");
    expect(output).not.toContain("internal.noop ");
    expect(output).not.toContain("payload");
    expect(output).not.toContain("resetUrl");
    expect(output).not.toContain("/reset-password");
    expect(output).not.toContain("token");
    expect(output).not.toContain("recipient@example.test");
    expect(output).not.toContain("secret");
  });

  it("keeps the CLI read-only and payload-free", () => {
    expect(packageJson).toContain("\"jobs:status\": \"tsx scripts/jobs-status.ts\"");
    expect(scriptSource).toContain("getJobQueueStatus()");
    expect(scriptSource).toContain("formatJobQueueStatus(status)");
    expect(scriptSource).toContain("Job queue status failed.");
    expect(scriptSource).not.toContain("runJobsOnce");
    expect(scriptSource).not.toContain("claimJobs");
    expect(scriptSource).not.toContain("job.payload");
    expect(scriptSource).not.toContain("payload");
    expect(scriptSource).not.toContain("resetUrl");
    expect(scriptSource).not.toContain("error.message");
  });

  it("documents that unregistered job types are collapsed instead of printed", () => {
    expect(deploymentReadinessSource).toContain("registered-safe job type counts");
    expect(deploymentReadinessSource).toContain("single `unregistered` count");
    expect(deploymentReadinessSource).toContain("arbitrary/unregistered job type names");
  });
});
