import { JobStatus, Prisma, type Job } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";

const activeDedupeStatuses = [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.FAILED] as const;
const defaultMaxAttempts = 3;
export const defaultStaleJobAfterMs = 15 * 60 * 1000;
export const defaultRetainSucceededJobDays = 7;
export const defaultRetainDeadJobDays = 30;
const maxLastErrorLength = 1000;
const retryBackoffMs = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

export type EnqueueJobInput = {
  dedupeKey?: string | null;
  maxAttempts?: number;
  payload: Prisma.InputJsonValue;
  runAt?: Date;
  type: string;
  workspaceId?: string | null;
};

export type ClaimJobsInput = {
  limit?: number;
  now?: Date;
  workerId: string;
};

export type RecoverStaleRunningJobsInput = {
  now?: Date;
  staleAfterMs?: number;
};

export type RecoverStaleRunningJobsResult = {
  cutoff: Date;
  recovered: number;
  runAt: Date;
  staleAfterMs: number;
};

export type CleanupTerminalJobsInput = {
  now?: Date;
  retainDeadDays?: number;
  retainSucceededDays?: number;
};

export type CleanupTerminalJobsResult = {
  deadCutoff: Date;
  deletedDead: number;
  deletedSucceeded: number;
  retainDeadDays: number;
  retainSucceededDays: number;
  succeededCutoff: Date;
  totalDeleted: number;
};

export type JobQueueStatus = {
  byStatus: Record<JobStatus, number>;
  duePendingCount: number;
  futurePendingCount: number;
  oldestDuePendingRunAt: Date | null;
  total: number;
  typeCounts: Array<{ count: number; type: string }>;
};

export async function enqueueJob(input: EnqueueJobInput) {
  const data = normalizeEnqueueInput(input);

  if (!data.dedupeKey) {
    return prisma.job.create({ data });
  }
  const dedupeKey = data.dedupeKey;

  return prisma.$transaction(async (tx) => {
    const existing = await findActiveDuplicateJob(tx, data.type, dedupeKey);
    if (existing) return existing;

    try {
      return await tx.job.create({ data });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await findActiveDuplicateJob(tx, data.type, dedupeKey);
      if (duplicate) return duplicate;
      throw error;
    }
  });
}

export async function enqueueUniqueJob(input: EnqueueJobInput & { dedupeKey: string }) {
  return enqueueJob(input);
}

export async function claimNextJob(input: ClaimJobsInput) {
  const [job] = await claimJobs({ ...input, limit: 1 });
  return job ?? null;
}

export async function claimJobs({ limit = 1, now = new Date(), workerId }: ClaimJobsInput) {
  const normalizedLimit = normalizeClaimLimit(limit);
  const normalizedWorkerId = readNonEmpty(workerId);
  if (!normalizedWorkerId) {
    throw new ApiError("VALIDATION_ERROR", "Job worker id is required.", 422);
  }
  const claimNow = now.toISOString();

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Job"
      WHERE "status" = 'PENDING'::"JobStatus"
        AND "runAt" <= ${claimNow}::timestamp
      ORDER BY "runAt" ASC, "createdAt" ASC
      LIMIT ${normalizedLimit}
      FOR UPDATE SKIP LOCKED
    `;
    const ids = candidates.map((candidate) => candidate.id);
    if (ids.length === 0) return [];

    await tx.job.updateMany({
      where: { id: { in: ids }, status: JobStatus.PENDING },
      data: {
        status: JobStatus.RUNNING,
        lockedAt: now,
        lockedBy: normalizedWorkerId,
        attempts: { increment: 1 }
      }
    });

    const jobs = await tx.job.findMany({ where: { id: { in: ids } } });
    return ids.map((id) => jobs.find((job) => job.id === id)).filter((job): job is Job => Boolean(job));
  });
}

export async function markJobSucceeded(jobId: string, now = new Date()) {
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.SUCCEEDED,
      lockedAt: null,
      lockedBy: null,
      processedAt: now,
      failedAt: null,
      lastError: null
    }
  });

  if (updated.count !== 1) {
    throw new ApiError("JOB_NOT_RUNNING", "Only a running job can be marked succeeded.", 409);
  }

  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

export async function markJobFailedForRetry(
  jobId: string,
  error: unknown,
  options: { now?: Date; retryAt?: Date } = {}
) {
  const now = options.now ?? new Date();
  const job = await getRunningJob(jobId);
  const lastError = formatJobError(error);

  if (job.attempts >= job.maxAttempts) {
    return markJobDead(jobId, lastError, now);
  }

  const runAt = options.retryAt ?? new Date(now.getTime() + retryDelayMs(job.attempts));
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PENDING,
      runAt,
      lockedAt: null,
      lockedBy: null,
      failedAt: null,
      lastError
    }
  });

  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

export async function markJobDead(jobId: string, error: unknown, now = new Date()) {
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.DEAD,
      lockedAt: null,
      lockedBy: null,
      failedAt: now,
      lastError: formatJobError(error)
    }
  });

  if (updated.count !== 1) {
    throw new ApiError("JOB_NOT_RUNNING", "Only a running job can be marked dead.", 409);
  }

  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

export async function releaseJob(jobId: string, options: { now?: Date; runAt?: Date } = {}) {
  const now = options.now ?? new Date();
  const runAt = options.runAt ?? now;
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.PENDING,
      runAt,
      lockedAt: null,
      lockedBy: null
    }
  });

  if (updated.count !== 1) {
    throw new ApiError("JOB_NOT_RUNNING", "Only a running job can be released.", 409);
  }

  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

export async function recoverStaleRunningJobs(
  options: RecoverStaleRunningJobsInput = {}
): Promise<RecoverStaleRunningJobsResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = normalizeStaleAfterMs(options.staleAfterMs);
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const updated = await prisma.job.updateMany({
    where: {
      status: JobStatus.RUNNING,
      lockedAt: { lt: cutoff }
    },
    data: {
      status: JobStatus.PENDING,
      runAt: now,
      lockedAt: null,
      lockedBy: null
    }
  });

  return {
    cutoff,
    recovered: updated.count,
    runAt: now,
    staleAfterMs
  };
}

export async function getJobQueueStatus(options: { now?: Date } = {}): Promise<JobQueueStatus> {
  const now = options.now ?? new Date();
  const [statusGroups, duePendingCount, futurePendingCount, oldestDuePending, typeGroups] = await Promise.all([
    prisma.job.groupBy({
      by: ["status"],
      _count: { _all: true }
    }),
    prisma.job.count({
      where: {
        status: JobStatus.PENDING,
        runAt: { lte: now }
      }
    }),
    prisma.job.count({
      where: {
        status: JobStatus.PENDING,
        runAt: { gt: now }
      }
    }),
    prisma.job.findFirst({
      where: {
        status: JobStatus.PENDING,
        runAt: { lte: now }
      },
      orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
      select: { runAt: true }
    }),
    prisma.job.groupBy({
      by: ["type"],
      _count: { _all: true },
      orderBy: { type: "asc" }
    })
  ]);
  const byStatus = createEmptyStatusCounts();

  for (const group of statusGroups) {
    byStatus[group.status] = group._count._all;
  }

  return {
    byStatus,
    duePendingCount,
    futurePendingCount,
    oldestDuePendingRunAt: oldestDuePending?.runAt ?? null,
    total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    typeCounts: typeGroups.map((group) => ({
      type: group.type,
      count: group._count._all
    }))
  };
}

export async function cleanupTerminalJobs(
  options: CleanupTerminalJobsInput = {}
): Promise<CleanupTerminalJobsResult> {
  const now = options.now ?? new Date();
  const retainSucceededDays = normalizeRetentionDays(
    options.retainSucceededDays,
    defaultRetainSucceededJobDays
  );
  const retainDeadDays = normalizeRetentionDays(options.retainDeadDays, defaultRetainDeadJobDays);
  const succeededCutoff = subtractDays(now, retainSucceededDays);
  const deadCutoff = subtractDays(now, retainDeadDays);

  const [deletedSucceeded, deletedDead] = await prisma.$transaction([
    prisma.job.deleteMany({
      where: {
        status: JobStatus.SUCCEEDED,
        processedAt: { lt: succeededCutoff }
      }
    }),
    prisma.job.deleteMany({
      where: {
        status: JobStatus.DEAD,
        failedAt: { lt: deadCutoff }
      }
    })
  ]);

  return {
    deadCutoff,
    deletedDead: deletedDead.count,
    deletedSucceeded: deletedSucceeded.count,
    retainDeadDays,
    retainSucceededDays,
    succeededCutoff,
    totalDeleted: deletedSucceeded.count + deletedDead.count
  };
}

function normalizeEnqueueInput(input: EnqueueJobInput): Prisma.JobUncheckedCreateInput {
  const type = readNonEmpty(input.type);
  if (!type) throw new ApiError("VALIDATION_ERROR", "Job type is required.", 422);

  const dedupeKey = readNonEmpty(input.dedupeKey ?? undefined);
  const maxAttempts = input.maxAttempts ?? defaultMaxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ApiError("VALIDATION_ERROR", "Job maxAttempts must be a positive integer.", 422);
  }

  return {
    workspaceId: input.workspaceId ?? null,
    type,
    payload: input.payload,
    maxAttempts,
    runAt: input.runAt ?? new Date(),
    dedupeKey: dedupeKey ?? null
  };
}

function normalizeClaimLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ApiError("VALIDATION_ERROR", "Job claim limit must be a positive integer.", 422);
  }

  return Math.min(limit, 100);
}

function normalizeStaleAfterMs(staleAfterMs: number | undefined) {
  if (staleAfterMs === undefined) return defaultStaleJobAfterMs;
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1) return defaultStaleJobAfterMs;
  return staleAfterMs;
}

function normalizeRetentionDays(value: number | undefined, defaultValue: number) {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1) return defaultValue;
  return value;
}

function subtractDays(date: Date, days: number) {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function findActiveDuplicateJob(
  tx: Prisma.TransactionClient,
  type: string,
  dedupeKey: string
) {
  return tx.job.findFirst({
    where: {
      type,
      dedupeKey,
      status: { in: [...activeDedupeStatuses] }
    },
    orderBy: { createdAt: "asc" }
  });
}

async function getRunningJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true, status: true }
  });

  if (!job) throw new ApiError("NOT_FOUND", "Job was not found.", 404);
  if (job.status !== JobStatus.RUNNING) {
    throw new ApiError("JOB_NOT_RUNNING", "Only a running job can be marked failed.", 409);
  }

  return job;
}

function retryDelayMs(attempts: number) {
  return retryBackoffMs[Math.min(Math.max(attempts - 1, 0), retryBackoffMs.length - 1)];
}

function formatJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[\w.+/~=-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s]+\/reset-password\?token=[^&\s]+[^\s]*/gi, "[redacted reset url]")
    .replace(/\/reset-password\?token=[^&\s]+[^\s]*/gi, "[redacted reset url]")
    .replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLastErrorLength);
}

function createEmptyStatusCounts(): Record<JobStatus, number> {
  return {
    [JobStatus.PENDING]: 0,
    [JobStatus.RUNNING]: 0,
    [JobStatus.SUCCEEDED]: 0,
    [JobStatus.FAILED]: 0,
    [JobStatus.DEAD]: 0
  };
}

function readNonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
