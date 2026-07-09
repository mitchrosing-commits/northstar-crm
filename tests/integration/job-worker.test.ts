import { JobStatus } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPasswordResetToken } from "@/lib/auth/password-reset";
import {
  internalNoopJobType,
  jobHandlers,
  passwordResetEmailJobType,
  workspaceInvitationEmailJobType,
  type JobHandlerRegistry
} from "@/lib/jobs/handlers";
import { runJobsOnce } from "@/lib/jobs/run-once";
import { runJobsWorker } from "@/lib/jobs/work";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type CrmServices = typeof import("@/lib/services/crm");
type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let crm: CrmServices;
let fixture: Fixture | undefined;

beforeAll(async () => {
  crm = await import("@/lib/services/crm");
});

beforeEach(async () => {
  fixture = await createIntegrationFixture();
  await deleteJobWorkerTestRows(fixture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (fixture) await deleteJobWorkerTestRows(fixture);
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("single-run job worker", () => {
  it("exits cleanly when there are no due jobs", async () => {
    const result = await runJobsOnce({
      workerId: "worker-empty",
      now: new Date("2030-03-01T11:00:00.000Z")
    });

    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0, dead: 0 });
  });

  it("continuous worker exits after idle timeout when there are no jobs", async () => {
    const result = await runJobsWorker({
      idleExitAfterMs: 0,
      pollIntervalMs: 1,
      workerId: "worker-idle",
      now: new Date("2030-03-01T11:30:00.000Z")
    });

    expect(result).toEqual({
      batches: 1,
      claimed: 0,
      recovered: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      stopped: false
    });
  });

  it("processes the internal noop job and marks it succeeded", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-01T12:00:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { purpose: "worker mechanics only" },
      runAt: now
    });

    const result = await runJobsOnce({ workerId: "worker-noop", now });
    const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
    expect(reloaded).toMatchObject({
      status: JobStatus.SUCCEEDED,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      failedAt: null,
      lastError: null
    });
    expect(reloaded.processedAt?.toISOString()).toBe(now.toISOString());
  });

  it("continuous worker processes the internal noop job and then exits after idle timeout", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-01T12:30:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { purpose: "continuous worker mechanics" },
      runAt: now
    });

    const result = await runJobsWorker({
      idleExitAfterMs: 0,
      pollIntervalMs: 1,
      workerId: "worker-continuous-noop",
      now
    });
    const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      dead: 0,
      stopped: false
    });
    expect(result.batches).toBeGreaterThanOrEqual(2);
    expect(reloaded).toMatchObject({
      status: JobStatus.SUCCEEDED,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      lastError: null
    });
  });

  it("continuous worker recovers stale running jobs before processing a batch", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-01T12:40:00.000Z");
    let observedRecovery = 0;
    let observedRecoveryDead = 0;
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { purpose: "stale recovery mechanics" },
      runAt: new Date("2030-03-01T12:00:00.000Z")
    });
    const maxedJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { purpose: "maxed stale recovery mechanics" },
      maxAttempts: 1,
      runAt: new Date("2030-03-01T12:00:00.000Z")
    });
    await fx.prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.RUNNING,
        attempts: 2,
        lockedAt: new Date("2030-03-01T12:10:00.000Z"),
        lockedBy: "crashed-worker"
      }
    });
    await fx.prisma.job.update({
      where: { id: maxedJob.id },
      data: {
        status: JobStatus.RUNNING,
        attempts: 1,
        lockedAt: new Date("2030-03-01T12:10:00.000Z"),
        lockedBy: "maxed-crashed-worker"
      }
    });

    const result = await runJobsWorker({
      idleExitAfterMs: 0,
      onRecoveryResult: (recovery) => {
        observedRecovery += recovery.recovered;
        observedRecoveryDead += recovery.dead;
      },
      pollIntervalMs: 1,
      staleAfterMs: 15 * 60 * 1000,
      workerId: "worker-stale-recovery",
      now
    });
    const [reloaded, reloadedMaxed] = await Promise.all([
      fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: maxedJob.id } })
    ]);

    expect(observedRecovery).toBe(1);
    expect(observedRecoveryDead).toBe(1);
    expect(result).toMatchObject({
      recovered: 1,
      claimed: 1,
      succeeded: 1,
      failed: 0,
      dead: 1,
      stopped: false
    });
    expect(result.batches).toBeGreaterThanOrEqual(2);
    expect(reloaded).toMatchObject({
      status: JobStatus.SUCCEEDED,
      attempts: 3,
      lockedAt: null,
      lockedBy: null,
      lastError: null
    });
    expect(reloadedMaxed).toMatchObject({
      status: JobStatus.DEAD,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      lastError: "Stale running job exceeded max attempts during recovery."
    });
    expect(reloadedMaxed.failedAt?.toISOString()).toBe(now.toISOString());
  });

  it("continuous worker passes the normalized worker id to claimed jobs", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-01T12:45:00.000Z");
    let observedLockedBy: string | null | undefined;
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "internal.inspect_worker",
      payload: {},
      runAt: now
    });

    const result = await runJobsWorker({
      handlers: {
        "internal.inspect_worker": async ({ job }) => {
          const claimed = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
          observedLockedBy = claimed.lockedBy;
        }
      },
      idleExitAfterMs: 0,
      pollIntervalMs: 1,
      workerId: "  worker-visible  ",
      now
    });
    const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result.succeeded).toBe(1);
    expect(observedLockedBy).toBe("worker-visible");
    expect(reloaded.status).toBe(JobStatus.SUCCEEDED);
  });

  it("continuous worker stops gracefully after the current batch when aborted", async () => {
    const fx = currentFixture();
    const abortController = new AbortController();
    const now = new Date("2030-03-01T12:50:00.000Z");
    await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: {},
      runAt: now
    });

    const result = await runJobsWorker({
      idleExitAfterMs: 1000,
      onBatchResult: () => abortController.abort(),
      pollIntervalMs: 1,
      signal: abortController.signal,
      workerId: "worker-graceful-stop",
      now
    });

    expect(result).toMatchObject({
      batches: 1,
      claimed: 1,
      recovered: 0,
      succeeded: 1,
      failed: 0,
      dead: 0,
      stopped: true
    });
  });

  it("handles internal noop validation failures without storing payload details in lastError", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-01T13:00:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: "payload-secret-reset-token",
      maxAttempts: 1,
      runAt: now
    });

    const result = await runJobsOnce({ workerId: "worker-noop-invalid", now });
    const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, dead: 1 });
    expect(reloaded.status).toBe(JobStatus.DEAD);
    expect(reloaded.lastError).toBe("Invalid internal noop job payload.");
    expect(reloaded.lastError).not.toContain("payload-secret-reset-token");
  });

  it("handles unknown job types safely through retry semantics", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-02T12:00:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "unknown.job_type",
      payload: { ignored: true },
      maxAttempts: 2,
      runAt: now
    });

    const result = await runJobsOnce({ workerId: "worker-unknown", now });
    const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1, dead: 0 });
    expect(reloaded).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      processedAt: null,
      failedAt: null
    });
    expect(reloaded.runAt.getTime()).toBeGreaterThan(now.getTime());
    expect(reloaded.lastError).toBe("No job handler registered.");
    expect(reloaded.lastError).not.toContain(job.type);
  });

  it("processes queued password reset email jobs through the Resend sender when configured", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: "resend-key"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "email-id" }), { status: 200 }));
    const now = new Date("2030-03-02T12:45:00.000Z");
    await createPasswordResetToken(fx.userA.id, "resend-reset-token", new Date("2030-03-02T13:15:00.000Z"));
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T13:15:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=resend-reset-token",
        to: fx.userA.email
      },
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-resend", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      expect(reloaded.status).toBe(JobStatus.SUCCEEDED);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("https://crm.example.test/reset-password?token=resend-reset-token")
        })
      );
      const [, requestInit] = fetchMock.mock.calls[0];
      const body = JSON.parse(String(requestInit?.body));
      const headers = new Headers(requestInit?.headers);
      expect(body).toMatchObject({
        from: "Northstar <onboarding@resend.dev>",
        subject: "Reset your Northstar CRM password",
        to: fx.userA.email
      });
      expect(headers.get("authorization")).toBe("Bearer resend-key");
      expect(JSON.stringify(body)).not.toContain("passwordHash");
    } finally {
      restoreEnv();
    }
  });

  it("processes queued password reset email jobs through the webhook sender", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_FROM: "Northstar CRM <no-reply@example.test>",
      AUTH_EMAIL_WEBHOOK_TOKEN: "webhook-token",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:00:00.000Z");
    await createPasswordResetToken(fx.userA.id, "queued-reset-token", new Date("2030-03-02T13:30:00.000Z"));
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T13:30:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=queued-reset-token",
        to: fx.userA.email
      },
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-email", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      expect(reloaded.status).toBe(JobStatus.SUCCEEDED);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://mail.example.test/auth-email",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            type: "password_reset",
            to: fx.userA.email,
            from: "Northstar CRM <no-reply@example.test>",
            resetUrl: "https://crm.example.test/reset-password?token=queued-reset-token",
            expiresAt: "2030-03-02T13:30:00.000Z"
          })
        })
      );
    } finally {
      restoreEnv();
    }
  });

  it("processes queued workspace invitation email jobs through the Resend sender when configured", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: "resend-key"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "email-id" }), { status: 200 }));
    const now = new Date("2030-03-02T13:01:00.000Z");
    const invitation = await crm.createWorkspaceInvitation(fx.actorA, {
      email: `queued-invite-${fx.workspaceA.id}@example.test`,
      role: "ADMIN"
    });
    const job = await fx.prisma.job.findFirstOrThrow({
      where: { workspaceId: fx.workspaceA.id, type: workspaceInvitationEmailJobType }
    });
    await fx.prisma.job.update({ where: { id: job.id }, data: { runAt: now } });

    try {
      const result = await runJobsOnce({ workerId: "worker-workspace-invitation-resend", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      expect(reloaded.status).toBe(JobStatus.SUCCEEDED);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(`https://crm.example.test/workspaces/invitations/${invitation.id}`)
        })
      );
      const [, requestInit] = fetchMock.mock.calls[0];
      const body = JSON.parse(String(requestInit?.body));
      const headers = new Headers(requestInit?.headers);
      expect(body).toMatchObject({
        from: "Northstar <onboarding@resend.dev>",
        subject: `You're invited to ${fx.workspaceA.name} on Northstar CRM`,
        to: invitation.email
      });
      expect(body.text).toContain("Invited role: Admin.");
      expect(body.text).toContain(fx.userA.email);
      expect(headers.get("authorization")).toBe("Bearer resend-key");
    } finally {
      restoreEnv();
    }
  });

  it("skips queued workspace invitation email jobs after an invitation is revoked", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
      RESEND_API_KEY: "resend-key"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "email-id" }), { status: 200 }));
    const now = new Date("2030-03-02T13:02:00.000Z");
    const invitation = await crm.createWorkspaceInvitation(fx.actorA, {
      email: `revoked-invite-${fx.workspaceA.id}@example.test`,
      role: "MEMBER"
    });
    const job = await fx.prisma.job.findFirstOrThrow({
      where: { workspaceId: fx.workspaceA.id, type: workspaceInvitationEmailJobType }
    });
    await fx.prisma.job.update({ where: { id: job.id }, data: { runAt: now } });
    await crm.revokeWorkspaceInvitation(fx.actorA, invitation.id);

    try {
      const result = await runJobsOnce({ workerId: "worker-workspace-invitation-revoked", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      expect(reloaded.status).toBe(JobStatus.SUCCEEDED);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it("continuous worker processes queued password reset email jobs through the webhook sender", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_FROM: "Northstar CRM <no-reply@example.test>",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:03:00.000Z");
    await createPasswordResetToken(fx.userA.id, "continuous-worker-reset-token", new Date("2030-03-02T13:33:00.000Z"));
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T13:33:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=continuous-worker-reset-token",
        to: fx.userA.email
      },
      runAt: now
    });

    try {
      const result = await runJobsWorker({
        idleExitAfterMs: 0,
        pollIntervalMs: 1,
        workerId: "worker-password-reset-continuous",
        now
      });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toMatchObject({
        claimed: 1,
        recovered: 0,
        succeeded: 1,
        failed: 0,
        dead: 0,
        stopped: false
      });
      expect(result.batches).toBeGreaterThanOrEqual(2);
      expect(reloaded).toMatchObject({
        status: JobStatus.SUCCEEDED,
        attempts: 1,
        lockedAt: null,
        lockedBy: null,
        lastError: null
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://mail.example.test/auth-email",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            type: "password_reset",
            to: fx.userA.email,
            from: "Northstar CRM <no-reply@example.test>",
            resetUrl: "https://crm.example.test/reset-password?token=continuous-worker-reset-token",
            expiresAt: "2030-03-02T13:33:00.000Z"
          })
        })
      );
    } finally {
      restoreEnv();
    }
  });

  it("drops superseded password reset email jobs before provider delivery", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:05:00.000Z");
    const expiresAt = new Date("2030-03-02T13:35:00.000Z");
    await Promise.all([
      createPasswordResetToken(fx.userA.id, "superseded-reset-token", expiresAt, new Date("2030-03-02T13:04:00.000Z")),
      createPasswordResetToken(fx.userA.id, "current-reset-token", expiresAt)
    ]);
    const supersededJob = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: expiresAt.toISOString(),
        resetUrl: "https://crm.example.test/reset-password?token=superseded-reset-token",
        to: fx.userA.email
      },
      runAt: now
    });
    const currentJob = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: expiresAt.toISOString(),
        resetUrl: "https://crm.example.test/reset-password?token=current-reset-token",
        to: fx.userA.email
      },
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-superseded", limit: 2, now });
      const [reloadedSuperseded, reloadedCurrent] = await Promise.all([
        fx.prisma.job.findUniqueOrThrow({ where: { id: supersededJob.id } }),
        fx.prisma.job.findUniqueOrThrow({ where: { id: currentJob.id } })
      ]);

      expect(result).toEqual({ claimed: 2, succeeded: 2, failed: 0, dead: 0 });
      expect(reloadedSuperseded).toMatchObject({ status: JobStatus.SUCCEEDED, lastError: null });
      expect(reloadedCurrent).toMatchObject({ status: JobStatus.SUCCEEDED, lastError: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][1]?.body)).toContain("current-reset-token");
      expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain("superseded-reset-token");
    } finally {
      restoreEnv();
    }
  });

  it("drops superseded password reset email jobs before checking delivery configuration", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_FROM: undefined,
      AUTH_EMAIL_WEBHOOK_URL: undefined,
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:07:00.000Z");
    const expiresAt = new Date("2030-03-02T13:37:00.000Z");
    await Promise.all([
      createPasswordResetToken(fx.userA.id, "superseded-no-config-token", expiresAt, new Date("2030-03-02T13:06:00.000Z")),
      createPasswordResetToken(fx.userA.id, "current-no-config-token", expiresAt)
    ]);
    const supersededJob = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: expiresAt.toISOString(),
        resetUrl: "https://crm.example.test/reset-password?token=superseded-no-config-token",
        to: fx.userA.email
      },
      maxAttempts: 1,
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-superseded-no-config", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: supersededJob.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      expect(reloaded).toMatchObject({
        status: JobStatus.SUCCEEDED,
        lastError: null,
        lockedAt: null,
        lockedBy: null
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it("rejects queued password reset email jobs whose reset URL does not match the app base URL", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:10:00.000Z");
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T13:40:00.000Z",
        resetUrl: "https://evil.example.test/reset-password?token=poisoned-reset-token",
        to: fx.userA.email
      },
      maxAttempts: 1,
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-poisoned-url", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, dead: 1 });
      expect(reloaded.status).toBe(JobStatus.DEAD);
      expect(reloaded.lastError).toBe("Invalid password reset email job payload.");
      expect(reloaded.lastError).not.toContain("poisoned-reset-token");
      expect(reloaded.lastError).not.toContain("evil.example.test");
      expect(reloaded.lastError).not.toContain(fx.userA.email);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it("rejects queued password reset email jobs whose reset URL contains credentials", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:15:00.000Z");
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T13:45:00.000Z",
        resetUrl: "https://preview:secret@crm.example.test/reset-password?token=credentialed-reset-token",
        to: fx.userA.email
      },
      maxAttempts: 1,
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-credentialed-url", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, dead: 1 });
      expect(reloaded.status).toBe(JobStatus.DEAD);
      expect(reloaded.lastError).toBe("Invalid password reset email job payload.");
      expect(reloaded.lastError).not.toContain("credentialed-reset-token");
      expect(reloaded.lastError).not.toContain("preview:secret");
      expect(reloaded.lastError).not.toContain(fx.userA.email);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it("rejects queued password reset email jobs with malformed recipients before provider delivery", async () => {
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:20:00.000Z");
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T13:50:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=malformed-recipient-token",
        to: "not-an-email"
      },
      maxAttempts: 1,
      runAt: now
    });

    try {
      const fx = currentFixture();
      const result = await runJobsOnce({ workerId: "worker-password-reset-malformed-recipient", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, dead: 1 });
      expect(reloaded.status).toBe(JobStatus.DEAD);
      expect(reloaded.lastError).toBe("Invalid password reset email job payload.");
      expect(reloaded.lastError).not.toContain("not-an-email");
      expect(reloaded.lastError).not.toContain("malformed-recipient-token");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it("drops expired password reset email jobs without sending dead reset links", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T14:01:00.000Z");
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T14:00:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=expired-reset-token",
        to: fx.userA.email
      },
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-expired", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      expect(reloaded).toMatchObject({
        status: JobStatus.SUCCEEDED,
        lockedAt: null,
        lockedBy: null,
        lastError: null
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it("shows password reset jobs as due pending before run-once and succeeded after processing", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date("2030-03-02T13:15:00.000Z");
    await createPasswordResetToken(fx.userA.id, "status-flow-token", new Date("2030-03-02T13:45:00.000Z"));
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T13:45:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=status-flow-token",
        to: fx.userA.email
      },
      runAt: now
    });

    try {
      const before = await crm.getJobQueueStatus({ now });
      const result = await runJobsOnce({ workerId: "worker-password-reset-status-flow", now });
      const after = await crm.getJobQueueStatus({ now: new Date("2030-03-02T13:16:00.000Z") });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(before).toMatchObject({
        duePendingCount: 1,
        futurePendingCount: 0,
        total: 1
      });
      expect(before.byStatus[JobStatus.PENDING]).toBe(1);
      expect(before.oldestDuePendingRunAt?.toISOString()).toBe(now.toISOString());
      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      expect(reloaded.status).toBe(JobStatus.SUCCEEDED);
      expect(after).toMatchObject({
        duePendingCount: 0,
        futurePendingCount: 0,
        total: 1
      });
      expect(after.byStatus[JobStatus.PENDING]).toBe(0);
      expect(after.byStatus[JobStatus.SUCCEEDED]).toBe(1);
    } finally {
      restoreEnv();
    }
  });

  it("retries password reset email jobs safely when webhook config is missing", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_FROM: undefined,
      AUTH_EMAIL_WEBHOOK_URL: undefined,
      RESEND_API_KEY: undefined
    });
    const now = new Date("2030-03-02T14:00:00.000Z");
    await createPasswordResetToken(fx.userA.id, "missing-config-token", new Date("2030-03-02T14:30:00.000Z"));
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T14:30:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=missing-config-token",
        to: fx.userA.email
      },
      maxAttempts: 1,
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-missing-config", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, dead: 1 });
      expect(reloaded.status).toBe(JobStatus.DEAD);
      expect(reloaded.lastError).toBe("Password reset email delivery is not configured.");
      expect(reloaded.lastError).not.toContain("missing-config-token");
    } finally {
      restoreEnv();
    }
  });

  it("retries password reset email webhook delivery failures without storing reset URLs or tokens in lastError", async () => {
    const fx = currentFixture();
    const restoreEnv = setAuthEmailEnv({
      APP_BASE_URL: "https://crm.example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
      RESEND_API_KEY: undefined
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const now = new Date("2030-03-02T15:00:00.000Z");
    await createPasswordResetToken(fx.userA.id, "provider-failure-token", new Date("2030-03-02T15:30:00.000Z"));
    const job = await crm.enqueueJob({
      type: passwordResetEmailJobType,
      payload: {
        expiresAt: "2030-03-02T15:30:00.000Z",
        resetUrl: "https://crm.example.test/reset-password?token=provider-failure-token",
        to: fx.userA.email
      },
      maxAttempts: 2,
      runAt: now
    });

    try {
      const result = await runJobsOnce({ workerId: "worker-password-reset-failed-delivery", now });
      const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

      expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1, dead: 0 });
      expect(reloaded).toMatchObject({
        status: JobStatus.PENDING,
        attempts: 1,
        lockedAt: null,
        lockedBy: null
      });
      expect(reloaded.lastError).toBe("Password reset email webhook failed.");
      expect(reloaded.lastError).not.toContain("provider-failure-token");
      expect(reloaded.lastError).not.toContain("reset-password");
      expect(reloaded.lastError).not.toContain(fx.userA.email);
    } finally {
      restoreEnv();
    }
  });

  it("redacts reset URLs from handler errors before storing lastError", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-02T16:00:00.000Z");
    const job = await crm.enqueueJob({
      type: "internal.reset_url_failure",
      payload: {},
      maxAttempts: 1,
      runAt: now
    });
    const handlers: JobHandlerRegistry = {
      "internal.reset_url_failure": async () => {
        throw new Error("Failed https://crm.example.test/reset-password?token=raw-reset-token for recipient@example.test");
      }
    };

    const result = await runJobsOnce({ handlers, workerId: "worker-reset-url-redaction", now });
    const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, dead: 1 });
    expect(reloaded.lastError).toContain("[redacted reset url]");
    expect(reloaded.lastError).toContain("[redacted email]");
    expect(reloaded.lastError).not.toContain("raw-reset-token");
    expect(reloaded.lastError).not.toContain("/reset-password");
    expect(reloaded.lastError).not.toContain("recipient@example.test");
  });

  it("dead-letters handler failures at max attempts", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-03T12:00:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "internal.test_failure",
      payload: { shouldFail: true },
      maxAttempts: 1,
      runAt: now
    });
    const handlers: JobHandlerRegistry = {
      "internal.test_failure": async () => {
        throw new Error("Handler failed with Bearer secret-token and /reset-password?token=raw-token");
      }
    };

    const result = await runJobsOnce({ handlers, workerId: "worker-dead", now });
    const reloaded = await fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, dead: 1 });
    expect(reloaded).toMatchObject({
      status: JobStatus.DEAD,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      processedAt: null
    });
    expect(reloaded.failedAt?.toISOString()).toBe(now.toISOString());
    expect(reloaded.lastError).toContain("Bearer [redacted]");
    expect(reloaded.lastError).toContain("[redacted reset url]");
    expect(reloaded.lastError).not.toContain("secret-token");
    expect(reloaded.lastError).not.toContain("raw-token");
  });

  it("does not process future or non-pending jobs", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-04T12:00:00.000Z");
    const futureJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: {},
      runAt: new Date("2030-03-04T12:05:00.000Z")
    });
    const runningJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: {},
      runAt: now
    });
    const succeededJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: {},
      runAt: now
    });
    const deadJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: {},
      runAt: now
    });
    await fx.prisma.job.update({ where: { id: runningJob.id }, data: { status: JobStatus.RUNNING } });
    await fx.prisma.job.update({ where: { id: succeededJob.id }, data: { status: JobStatus.SUCCEEDED } });
    await fx.prisma.job.update({ where: { id: deadJob.id }, data: { status: JobStatus.DEAD } });

    const result = await runJobsOnce({ workerId: "worker-skip", now });

    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0, dead: 0 });
    await expect(fx.prisma.job.findUniqueOrThrow({ where: { id: futureJob.id } })).resolves.toMatchObject({
      status: JobStatus.PENDING,
      attempts: 0
    });
  });

  it("respects batch size and continues after a bad job", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-05T12:00:00.000Z");
    const badJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "internal.unknown_for_batch",
      payload: { bad: true },
      maxAttempts: 1,
      runAt: new Date("2030-03-05T11:58:00.000Z")
    });
    const goodJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { good: true },
      runAt: new Date("2030-03-05T11:59:00.000Z")
    });
    const unclaimedJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { later: true },
      runAt: new Date("2030-03-05T12:00:00.000Z")
    });

    const result = await runJobsOnce({ workerId: "worker-batch", limit: 2, now });
    const [reloadedBad, reloadedGood, reloadedUnclaimed] = await Promise.all([
      fx.prisma.job.findUniqueOrThrow({ where: { id: badJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: goodJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: unclaimedJob.id } })
    ]);

    expect(result).toEqual({ claimed: 2, succeeded: 1, failed: 0, dead: 1 });
    expect(reloadedBad.status).toBe(JobStatus.DEAD);
    expect(reloadedGood.status).toBe(JobStatus.SUCCEEDED);
    expect(reloadedUnclaimed).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 0,
      lockedAt: null,
      lockedBy: null
    });
  });

  it("continuous worker continues polling after one failed job", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-05T12:30:00.000Z");
    const badJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "internal.continuous_unknown",
      payload: { bad: true },
      maxAttempts: 1,
      runAt: new Date("2030-03-05T12:28:00.000Z")
    });
    const goodJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { good: true },
      runAt: new Date("2030-03-05T12:29:00.000Z")
    });

    const result = await runJobsWorker({
      idleExitAfterMs: 0,
      limit: 1,
      pollIntervalMs: 1,
      workerId: "worker-continuous-failure",
      now
    });
    const [reloadedBad, reloadedGood] = await Promise.all([
      fx.prisma.job.findUniqueOrThrow({ where: { id: badJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: goodJob.id } })
    ]);

    expect(result).toMatchObject({
      claimed: 2,
      succeeded: 1,
      failed: 0,
      dead: 1,
      stopped: false
    });
    expect(result.batches).toBeGreaterThanOrEqual(3);
    expect(reloadedBad.status).toBe(JobStatus.DEAD);
    expect(reloadedGood.status).toBe(JobStatus.SUCCEEDED);
  });

  it("retries injected handler failures below max attempts while later jobs still succeed", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-06T12:00:00.000Z");
    const failedJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "internal.retry_failure",
      payload: { fail: true },
      maxAttempts: 2,
      runAt: new Date("2030-03-06T11:58:00.000Z")
    });
    const goodJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: internalNoopJobType,
      payload: { good: true },
      runAt: new Date("2030-03-06T11:59:00.000Z")
    });
    const handlers: JobHandlerRegistry = {
      ...jobHandlers,
      "internal.retry_failure": async () => {
        throw new Error("Temporary internal failure");
      }
    };

    const result = await runJobsOnce({ handlers, workerId: "worker-retry", limit: 2, now });
    const [reloadedFailed, reloadedGood] = await Promise.all([
      fx.prisma.job.findUniqueOrThrow({ where: { id: failedJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: goodJob.id } })
    ]);

    expect(result).toEqual({ claimed: 2, succeeded: 1, failed: 1, dead: 0 });
    expect(reloadedFailed).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      lastError: "Temporary internal failure"
    });
    expect(reloadedFailed.runAt.getTime()).toBeGreaterThan(now.getTime());
    expect(reloadedGood.status).toBe(JobStatus.SUCCEEDED);
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}

async function deleteJobWorkerTestRows(fx: Fixture) {
  await fx.prisma.job.deleteMany({
    where: {
      OR: [
        { workspaceId: { in: [fx.workspaceA.id, fx.workspaceB.id] } },
        { type: { startsWith: "internal." } },
        { type: "unknown.job_type" },
        { type: passwordResetEmailJobType },
        { type: workspaceInvitationEmailJobType }
      ]
    }
  });
}

async function createPasswordResetToken(userId: string, resetToken: string, expiresAt: Date, consumedAt: Date | null = null) {
  const fx = currentFixture();
  return fx.prisma.passwordResetToken.create({
    data: {
      consumedAt,
      expiresAt,
      tokenHash: hashPasswordResetToken(resetToken),
      userId
    }
  });
}

function setAuthEmailEnv(nextEnv: Record<string, string | undefined>) {
  const previousEnv = Object.fromEntries(Object.keys(nextEnv).map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
