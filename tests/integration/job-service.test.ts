import { JobStatus } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("database-backed job service foundation", () => {
  it("reports empty queue status without exposing payloads", async () => {
    const status = await crm.getJobQueueStatus({ now: new Date("2030-02-01T12:00:00.000Z") });

    expect(status).toEqual({
      total: 0,
      byStatus: {
        [JobStatus.PENDING]: 0,
        [JobStatus.RUNNING]: 0,
        [JobStatus.SUCCEEDED]: 0,
        [JobStatus.FAILED]: 0,
        [JobStatus.DEAD]: 0
      },
      duePendingCount: 0,
      futurePendingCount: 0,
      oldestDuePendingRunAt: null,
      typeCounts: []
    });
  });

  it("reports aggregate queue status counts, due split, oldest due pending, and type counts", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-01T12:00:00.000Z");
    const oldDue = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "auth.password_reset_email",
      payload: {
        resetUrl: "https://crm.example.test/reset-password?token=old-due-token",
        to: "recipient@example.test"
      },
      runAt: new Date("2030-02-01T11:00:00.000Z")
    });
    await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "auth.password_reset_email",
      payload: {
        resetUrl: "https://crm.example.test/reset-password?token=due-token",
        to: "recipient@example.test"
      },
      runAt: new Date("2030-02-01T11:30:00.000Z")
    });
    const future = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "internal.noop",
      payload: { secret: "do-not-print" },
      runAt: new Date("2030-02-01T12:30:00.000Z")
    });
    const running = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.running",
      payload: { ok: true },
      runAt: now
    });
    const succeeded = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.succeeded",
      payload: { ok: true },
      runAt: now
    });
    const failed = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.failed",
      payload: { ok: false },
      runAt: now
    });
    const dead = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.dead",
      payload: { ok: false },
      runAt: now
    });
    await Promise.all([
      fx.prisma.job.update({ where: { id: running.id }, data: { status: JobStatus.RUNNING } }),
      fx.prisma.job.update({ where: { id: succeeded.id }, data: { status: JobStatus.SUCCEEDED } }),
      fx.prisma.job.update({ where: { id: failed.id }, data: { status: JobStatus.FAILED } }),
      fx.prisma.job.update({ where: { id: dead.id }, data: { status: JobStatus.DEAD } })
    ]);

    const status = await crm.getJobQueueStatus({ now });

    expect(status.total).toBe(7);
    expect(status.byStatus).toEqual({
      [JobStatus.PENDING]: 3,
      [JobStatus.RUNNING]: 1,
      [JobStatus.SUCCEEDED]: 1,
      [JobStatus.FAILED]: 1,
      [JobStatus.DEAD]: 1
    });
    expect(status.duePendingCount).toBe(2);
    expect(status.futurePendingCount).toBe(1);
    expect(status.oldestDuePendingRunAt?.toISOString()).toBe(oldDue.runAt.toISOString());
    expect(status.typeCounts).toEqual([
      { type: "auth.password_reset_email", count: 2 },
      { type: "internal.noop", count: 1 },
      { type: "test.dead", count: 1 },
      { type: "test.failed", count: 1 },
      { type: "test.running", count: 1 },
      { type: "test.succeeded", count: 1 }
    ]);
    expect(status.typeCounts.map((typeCount) => typeCount.type)).not.toContain("recipient@example.test");
    expect(status.typeCounts.map((typeCount) => typeCount.type)).not.toContain(String(future.payload));
  });

  it("enqueues pending jobs with defaults and optional workspace scope", async () => {
    const fx = currentFixture();
    const globalJob = await crm.enqueueJob({
      type: "test.global",
      payload: { ok: true }
    });

    try {
      const workspaceJob = await crm.enqueueJob({
        workspaceId: fx.workspaceA.id,
        type: "test.workspace",
        payload: { workspace: "A" }
      });

      expect(globalJob).toMatchObject({
        workspaceId: null,
        type: "test.global",
        status: JobStatus.PENDING,
        attempts: 0,
        maxAttempts: 3,
        lockedAt: null,
        lockedBy: null,
        processedAt: null,
        failedAt: null,
        lastError: null,
        dedupeKey: null
      });
      expect(globalJob.runAt).toBeInstanceOf(Date);
      expect(workspaceJob).toMatchObject({
        workspaceId: fx.workspaceA.id,
        type: "test.workspace",
        status: JobStatus.PENDING
      });
      expect(await fx.prisma.job.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(1);
      expect(await fx.prisma.job.count({ where: { workspaceId: fx.workspaceB.id } })).toBe(0);
    } finally {
      await fx.prisma.job.deleteMany({ where: { id: globalJob.id } });
    }
  });

  it("claims only due pending jobs and locks them for a worker", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-01T12:00:00.000Z");
    const runningJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.running",
      payload: { running: true },
      runAt: new Date("2030-02-01T11:57:00.000Z")
    });
    const dueJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.due",
      payload: { due: true },
      runAt: new Date("2030-02-01T11:59:00.000Z")
    });
    const futureJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.future",
      payload: { due: false },
      runAt: new Date("2030-02-01T12:01:00.000Z")
    });
    const deadJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.dead",
      payload: { dead: true },
      runAt: new Date("2030-02-01T11:58:00.000Z")
    });
    const succeededJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.succeeded",
      payload: { succeeded: true },
      runAt: new Date("2030-02-01T11:56:00.000Z")
    });
    const failedJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.failed",
      payload: { failed: true },
      runAt: new Date("2030-02-01T11:55:00.000Z")
    });
    await fx.prisma.job.update({ where: { id: runningJob.id }, data: { status: JobStatus.RUNNING } });
    await fx.prisma.job.update({ where: { id: deadJob.id }, data: { status: JobStatus.DEAD } });
    await fx.prisma.job.update({ where: { id: succeededJob.id }, data: { status: JobStatus.SUCCEEDED } });
    await fx.prisma.job.update({ where: { id: failedJob.id }, data: { status: JobStatus.FAILED } });

    const claimed = await crm.claimJobs({ workerId: "worker-a", limit: 10, now });
    const [reloadedDueJob, reloadedFutureJob, reloadedDeadJob, reloadedRunningJob, reloadedSucceededJob, reloadedFailedJob] = await Promise.all([
      fx.prisma.job.findUniqueOrThrow({ where: { id: dueJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: futureJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: deadJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: runningJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: succeededJob.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: failedJob.id } })
    ]);

    expect(claimed.map((job) => job.id)).toEqual([dueJob.id]);
    expect(reloadedDueJob).toMatchObject({
      status: JobStatus.RUNNING,
      lockedBy: "worker-a",
      attempts: 1
    });
    expect(reloadedDueJob.lockedAt?.toISOString()).toBe(now.toISOString());
    expect(reloadedFutureJob.status).toBe(JobStatus.PENDING);
    expect(reloadedFutureJob.attempts).toBe(0);
    expect(reloadedDeadJob.status).toBe(JobStatus.DEAD);
    expect(reloadedRunningJob.status).toBe(JobStatus.RUNNING);
    expect(reloadedSucceededJob.status).toBe(JobStatus.SUCCEEDED);
    expect(reloadedFailedJob.status).toBe(JobStatus.FAILED);
    expect(await crm.claimNextJob({ workerId: "worker-b", now })).toBeNull();
  });

  it("respects claim limits and orders by runAt before createdAt", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-01T12:00:00.000Z");
    const second = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.order.second",
      payload: { order: 2 },
      runAt: new Date("2030-02-01T11:59:00.000Z")
    });
    const first = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.order.first",
      payload: { order: 1 },
      runAt: new Date("2030-02-01T11:58:00.000Z")
    });
    const third = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.order.third",
      payload: { order: 3 },
      runAt: new Date("2030-02-01T12:00:00.000Z")
    });

    const claimed = await crm.claimJobs({ workerId: "worker-order", limit: 2, now });
    const unclaimed = await fx.prisma.job.findUniqueOrThrow({ where: { id: third.id } });

    expect(claimed.map((job) => job.id)).toEqual([first.id, second.id]);
    expect(claimed.every((job) => job.lockedBy === "worker-order")).toBe(true);
    expect(unclaimed.status).toBe(JobStatus.PENDING);
    expect(unclaimed.attempts).toBe(0);
  });

  it("marks running jobs succeeded without retry state", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-02T12:00:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.success",
      payload: { ok: true },
      runAt: now
    });
    const claimed = await crm.claimNextJob({ workerId: "worker-success", now });
    const succeeded = await crm.markJobSucceeded(job.id, new Date("2030-02-02T12:01:00.000Z"));

    expect(claimed?.id).toBe(job.id);
    expect(succeeded).toMatchObject({
      status: JobStatus.SUCCEEDED,
      lockedAt: null,
      lockedBy: null,
      failedAt: null,
      lastError: null,
      attempts: 1
    });
    expect(succeeded.processedAt?.toISOString()).toBe("2030-02-02T12:01:00.000Z");
  });

  it("requeues retryable failures with redacted error text", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-03T12:00:00.000Z");
    const retryAt = new Date("2030-02-03T12:05:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.retry",
      payload: { attempt: "retry" },
      maxAttempts: 3,
      runAt: now
    });
    await crm.claimNextJob({ workerId: "worker-retry", now });

    const failed = await crm.markJobFailedForRetry(
      job.id,
      new Error("Webhook failed with Bearer super-secret-token at /reset-password?token=raw-reset-token"),
      { now, retryAt }
    );

    expect(failed).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      processedAt: null,
      failedAt: null
    });
    expect(failed.runAt.toISOString()).toBe(retryAt.toISOString());
    expect(failed.lastError).toContain("Bearer [redacted]");
    expect(failed.lastError).toContain("[redacted reset url]");
    expect(failed.lastError).not.toContain("/reset-password");
    expect(failed.lastError).not.toContain("super-secret-token");
    expect(failed.lastError).not.toContain("raw-reset-token");
    expect(failed.lastError?.length).toBeLessThanOrEqual(1000);
  });

  it("marks exhausted failures dead", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-04T12:00:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.dead",
      payload: { attempt: "final" },
      maxAttempts: 1,
      runAt: now
    });
    await crm.claimNextJob({ workerId: "worker-dead", now });

    const dead = await crm.markJobFailedForRetry(job.id, "permanent provider failure", { now });

    expect(dead).toMatchObject({
      status: JobStatus.DEAD,
      attempts: 1,
      lockedAt: null,
      lockedBy: null,
      processedAt: null,
      lastError: "permanent provider failure"
    });
    expect(dead.failedAt?.toISOString()).toBe(now.toISOString());
  });

  it("rejects terminal transitions for jobs that are not running", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-04T13:00:00.000Z");
    const pendingJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.not-running",
      payload: { ok: false },
      runAt: new Date("2030-02-04T13:05:00.000Z")
    });
    const runningJob = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.succeeded-lock",
      payload: { ok: true },
      runAt: now
    });
    await crm.claimNextJob({ workerId: "worker-terminal", now });
    const succeeded = await crm.markJobSucceeded(runningJob.id, new Date("2030-02-04T13:01:00.000Z"));

    await expect(crm.markJobSucceeded(pendingJob.id, now)).rejects.toMatchObject({ code: "JOB_NOT_RUNNING" });
    await expect(crm.markJobFailedForRetry(pendingJob.id, "not running", { now })).rejects.toMatchObject({
      code: "JOB_NOT_RUNNING"
    });
    await expect(crm.markJobDead(pendingJob.id, "not running", now)).rejects.toMatchObject({
      code: "JOB_NOT_RUNNING"
    });
    await expect(crm.markJobDead(succeeded.id, "do not rewrite success", now)).rejects.toMatchObject({
      code: "JOB_NOT_RUNNING"
    });
    expect((await fx.prisma.job.findUniqueOrThrow({ where: { id: succeeded.id } })).status).toBe(JobStatus.SUCCEEDED);
  });

  it("releases running jobs without decrementing attempts", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-04T14:00:00.000Z");
    const runAt = new Date("2030-02-04T14:10:00.000Z");
    const job = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.release",
      payload: { release: true },
      runAt: now
    });
    await crm.claimNextJob({ workerId: "worker-release", now });

    const released = await crm.releaseJob(job.id, { now, runAt });

    expect(released).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 1,
      lockedAt: null,
      lockedBy: null
    });
    expect(released.runAt.toISOString()).toBe(runAt.toISOString());
  });

  it("recovers only stale running jobs without changing attempts or lastError", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-04T15:00:00.000Z");
    const staleLockedAt = new Date("2030-02-04T14:40:00.000Z");
    const recentLockedAt = new Date("2030-02-04T14:55:00.000Z");
    const staleRunning = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.stale-running",
      payload: { resetUrl: "https://crm.example.test/reset-password?token=do-not-print" },
      runAt: new Date("2030-02-04T14:30:00.000Z")
    });
    const recentRunning = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.recent-running",
      payload: { ok: true },
      runAt: new Date("2030-02-04T14:30:00.000Z")
    });
    const runningWithoutLock = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.running-without-lock",
      payload: { ok: true },
      runAt: new Date("2030-02-04T14:30:00.000Z")
    });
    const pending = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.pending",
      payload: { ok: true },
      runAt: new Date("2030-02-04T14:30:00.000Z")
    });
    const succeeded = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.succeeded",
      payload: { ok: true },
      runAt: new Date("2030-02-04T14:30:00.000Z")
    });
    const failed = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.failed",
      payload: { ok: true },
      runAt: new Date("2030-02-04T14:30:00.000Z")
    });
    const dead = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.dead",
      payload: { ok: true },
      runAt: new Date("2030-02-04T14:30:00.000Z")
    });
    await Promise.all([
      fx.prisma.job.update({
        where: { id: staleRunning.id },
        data: {
          status: JobStatus.RUNNING,
          attempts: 2,
          lockedAt: staleLockedAt,
          lockedBy: "crashed-worker",
          lastError: "previous provider failure"
        }
      }),
      fx.prisma.job.update({
        where: { id: recentRunning.id },
        data: {
          status: JobStatus.RUNNING,
          attempts: 1,
          lockedAt: recentLockedAt,
          lockedBy: "active-worker"
        }
      }),
      fx.prisma.job.update({
        where: { id: runningWithoutLock.id },
        data: { status: JobStatus.RUNNING, attempts: 1, lockedAt: null, lockedBy: "invalid-lock" }
      }),
      fx.prisma.job.update({ where: { id: succeeded.id }, data: { status: JobStatus.SUCCEEDED } }),
      fx.prisma.job.update({ where: { id: failed.id }, data: { status: JobStatus.FAILED } }),
      fx.prisma.job.update({ where: { id: dead.id }, data: { status: JobStatus.DEAD } })
    ]);

    const recovery = await crm.recoverStaleRunningJobs({ now, staleAfterMs: 15 * 60 * 1000 });
    const [recovered, recent, invalidLock, stillPending, stillSucceeded, stillFailed, stillDead] = await Promise.all([
      fx.prisma.job.findUniqueOrThrow({ where: { id: staleRunning.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: recentRunning.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: runningWithoutLock.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: pending.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: succeeded.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: failed.id } }),
      fx.prisma.job.findUniqueOrThrow({ where: { id: dead.id } })
    ]);

    expect(recovery).toEqual({
      cutoff: new Date("2030-02-04T14:45:00.000Z"),
      recovered: 1,
      runAt: now,
      staleAfterMs: 15 * 60 * 1000
    });
    expect(recovered).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 2,
      lockedAt: null,
      lockedBy: null,
      lastError: "previous provider failure"
    });
    expect(recovered.runAt.toISOString()).toBe(now.toISOString());
    expect(recent).toMatchObject({
      status: JobStatus.RUNNING,
      attempts: 1,
      lockedBy: "active-worker"
    });
    expect(recent.lockedAt?.toISOString()).toBe(recentLockedAt.toISOString());
    expect(invalidLock.status).toBe(JobStatus.RUNNING);
    expect(stillPending.status).toBe(JobStatus.PENDING);
    expect(stillSucceeded.status).toBe(JobStatus.SUCCEEDED);
    expect(stillFailed.status).toBe(JobStatus.FAILED);
    expect(stillDead.status).toBe(JobStatus.DEAD);
  });

  it("cleans up old terminal jobs while preserving active and recent jobs", async () => {
    const fx = currentFixture();
    const now = new Date("2030-05-01T12:00:00.000Z");
    const oldSucceeded = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "auth.password_reset_email",
      payload: {
        resetUrl: "https://crm.example.test/reset-password?token=old-succeeded-secret",
        to: "recipient@example.test"
      },
      runAt: new Date("2030-04-01T12:00:00.000Z")
    });
    const recentSucceeded = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.recent-succeeded",
      payload: { ok: true },
      runAt: new Date("2030-04-28T12:00:00.000Z")
    });
    const oldDead = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.old-dead",
      payload: { ok: false },
      runAt: new Date("2030-03-01T12:00:00.000Z")
    });
    const recentDead = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.recent-dead",
      payload: { ok: false },
      runAt: new Date("2030-04-20T12:00:00.000Z")
    });
    const pending = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.pending",
      payload: { ok: true },
      runAt: now
    });
    const running = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.running",
      payload: { ok: true },
      runAt: now
    });
    const failed = await crm.enqueueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.failed",
      payload: { ok: false },
      runAt: now
    });
    await Promise.all([
      fx.prisma.job.update({
        where: { id: oldSucceeded.id },
        data: {
          status: JobStatus.SUCCEEDED,
          processedAt: new Date("2030-04-20T11:59:59.000Z")
        }
      }),
      fx.prisma.job.update({
        where: { id: recentSucceeded.id },
        data: {
          status: JobStatus.SUCCEEDED,
          processedAt: new Date("2030-04-25T12:00:00.000Z")
        }
      }),
      fx.prisma.job.update({
        where: { id: oldDead.id },
        data: {
          status: JobStatus.DEAD,
          failedAt: new Date("2030-03-31T11:59:59.000Z"),
          lastError: "redacted provider failure"
        }
      }),
      fx.prisma.job.update({
        where: { id: recentDead.id },
        data: {
          status: JobStatus.DEAD,
          failedAt: new Date("2030-04-05T12:00:00.000Z")
        }
      }),
      fx.prisma.job.update({
        where: { id: running.id },
        data: {
          status: JobStatus.RUNNING,
          lockedAt: now,
          lockedBy: "active-worker"
        }
      }),
      fx.prisma.job.update({ where: { id: failed.id }, data: { status: JobStatus.FAILED } })
    ]);

    const cleanup = await crm.cleanupTerminalJobs({
      now,
      retainDeadDays: 30,
      retainSucceededDays: 7
    });
    const status = await crm.getJobQueueStatus({ now });

    expect(cleanup).toEqual({
      deadCutoff: new Date("2030-04-01T12:00:00.000Z"),
      deletedDead: 1,
      deletedSucceeded: 1,
      retainDeadDays: 30,
      retainSucceededDays: 7,
      succeededCutoff: new Date("2030-04-24T12:00:00.000Z"),
      totalDeleted: 2
    });
    await expect(fx.prisma.job.findUnique({ where: { id: oldSucceeded.id } })).resolves.toBeNull();
    await expect(fx.prisma.job.findUnique({ where: { id: oldDead.id } })).resolves.toBeNull();
    await expect(fx.prisma.job.findUnique({ where: { id: recentSucceeded.id } })).resolves.toMatchObject({
      status: JobStatus.SUCCEEDED
    });
    await expect(fx.prisma.job.findUnique({ where: { id: recentDead.id } })).resolves.toMatchObject({
      status: JobStatus.DEAD
    });
    await expect(fx.prisma.job.findUnique({ where: { id: pending.id } })).resolves.toMatchObject({
      status: JobStatus.PENDING
    });
    await expect(fx.prisma.job.findUnique({ where: { id: running.id } })).resolves.toMatchObject({
      status: JobStatus.RUNNING
    });
    await expect(fx.prisma.job.findUnique({ where: { id: failed.id } })).resolves.toMatchObject({
      status: JobStatus.FAILED
    });
    expect(status.byStatus).toMatchObject({
      [JobStatus.PENDING]: 1,
      [JobStatus.RUNNING]: 1,
      [JobStatus.SUCCEEDED]: 1,
      [JobStatus.FAILED]: 1,
      [JobStatus.DEAD]: 1
    });
  });

  it("dedupes active jobs by type and dedupe key but allows new jobs after terminal status", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-05T12:00:00.000Z");
    const first = await crm.enqueueUniqueJob({
      workspaceId: fx.workspaceA.id,
      type: "auth.password_reset_email",
      dedupeKey: "password-reset-token-1",
      payload: { attempt: 1 },
      runAt: now
    });
    const duplicate = await crm.enqueueUniqueJob({
      workspaceId: fx.workspaceA.id,
      type: "auth.password_reset_email",
      dedupeKey: "password-reset-token-1",
      payload: { attempt: 2 },
      runAt: now
    });

    expect(duplicate.id).toBe(first.id);
    expect(await fx.prisma.job.count({ where: { type: "auth.password_reset_email", dedupeKey: "password-reset-token-1" } })).toBe(1);

    await crm.claimNextJob({ workerId: "worker-dedupe", now });
    await crm.markJobSucceeded(first.id, new Date("2030-02-05T12:01:00.000Z"));
    const afterTerminal = await crm.enqueueUniqueJob({
      workspaceId: fx.workspaceA.id,
      type: "auth.password_reset_email",
      dedupeKey: "password-reset-token-1",
      payload: { attempt: 3 },
      runAt: now
    });

    expect(afterTerminal.id).not.toBe(first.id);
    expect(await fx.prisma.job.count({ where: { type: "auth.password_reset_email", dedupeKey: "password-reset-token-1" } })).toBe(2);
  });

  it("dedupe keys are scoped by type and dedupe key, not workspace", async () => {
    const fx = currentFixture();
    const now = new Date("2030-02-06T12:00:00.000Z");
    const workspaceAJob = await crm.enqueueUniqueJob({
      workspaceId: fx.workspaceA.id,
      type: "test.global-dedupe",
      dedupeKey: "shared-key",
      payload: { workspace: "A" },
      runAt: now
    });
    const workspaceBDuplicate = await crm.enqueueUniqueJob({
      workspaceId: fx.workspaceB.id,
      type: "test.global-dedupe",
      dedupeKey: "shared-key",
      payload: { workspace: "B" },
      runAt: now
    });
    const differentType = await crm.enqueueUniqueJob({
      workspaceId: fx.workspaceB.id,
      type: "test.other-dedupe-type",
      dedupeKey: "shared-key",
      payload: { workspace: "B" },
      runAt: now
    });

    expect(workspaceBDuplicate.id).toBe(workspaceAJob.id);
    expect(workspaceBDuplicate.workspaceId).toBe(fx.workspaceA.id);
    expect(differentType.id).not.toBe(workspaceAJob.id);
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
