import { JobStatus, Prisma, type Job } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { jobMaxAttemptsMax } from "@/lib/product-limits";
import { redactSensitiveText } from "@/lib/security/redaction";

const activeDedupeStatuses = [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.FAILED] as const;
const defaultMaxAttempts = 3;
export const defaultStaleJobAfterMs = 15 * 60 * 1000;
export const defaultRetainSucceededJobDays = 7;
export const defaultRetainDeadJobDays = 30;
const maxLastErrorLength = 1000;
const jobTypeMaxLength = 120;
const jobTypePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const retryBackoffMs = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
type NormalizedJsonValue = string | number | boolean | null | NormalizedJsonValue[] | { [key: string]: NormalizedJsonValue };

export type EnqueueJobInput = {
  dedupeKey?: unknown;
  maxAttempts?: number;
  payload: Prisma.InputJsonValue;
  runAt?: Date;
  type: unknown;
  workspaceId?: unknown;
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
  dead: number;
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

export async function enqueueJob(input: unknown) {
  const data = normalizeEnqueueInput(input);
  if (data.workspaceId) await assertActiveJobWorkspace(data.workspaceId);

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

export async function enqueueUniqueJob(input: unknown) {
  return enqueueJob(input);
}

export async function claimNextJob(input: unknown) {
  const [job] = await claimJobs({ ...objectInput(input), limit: 1 });
  return job ?? null;
}

export async function claimJobs(input: unknown = {}) {
  const claimInput = objectInput(input);
  const normalizedLimit = normalizeClaimLimit(claimInput.limit);
  const normalizedWorkerId = readNonEmpty(claimInput.workerId);
  if (!normalizedWorkerId) {
    throw new ApiError("VALIDATION_ERROR", "Job worker id is required.", 422);
  }
  const now = normalizeOptionalJobDate(claimInput.now, "Job claim timestamp is invalid.");
  const claimNow = now.toISOString();

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Job"
      WHERE "status" = 'PENDING'::"JobStatus"
        AND "runAt" <= ${claimNow}::timestamp
        AND (
          "workspaceId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "Workspace"
            WHERE "Workspace"."id" = "Job"."workspaceId"
              AND "Workspace"."deletedAt" IS NULL
          )
        )
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
  assertValidJobDate(now, "Job completion timestamp is invalid.");
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
  assertValidJobDate(now, "Job failure timestamp is invalid.");
  if (options.retryAt) assertValidJobDate(options.retryAt, "Job retry timestamp is invalid.");
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
  assertValidJobDate(now, "Job failure timestamp is invalid.");
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
  assertValidJobDate(now, "Job release timestamp is invalid.");
  assertValidJobDate(runAt, "Job run timestamp is invalid.");
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.PENDING,
      runAt,
      lockedAt: null,
      lockedBy: null,
      failedAt: null
    }
  });

  if (updated.count !== 1) {
    throw new ApiError("JOB_NOT_RUNNING", "Only a running job can be released.", 409);
  }

  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

export async function recoverStaleRunningJobs(
  options: unknown = {}
): Promise<RecoverStaleRunningJobsResult> {
  const input = objectInput(options);
  const now = normalizeOptionalJobDate(input.now, "Job recovery timestamp is invalid.");
  const staleAfterMs = normalizeStaleAfterMs(input.staleAfterMs);
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const staleJobs = await prisma.job.findMany({
    where: {
      status: JobStatus.RUNNING,
      lockedAt: { lt: cutoff },
      ...activeJobWorkspaceWhere()
    },
    select: { attempts: true, id: true, maxAttempts: true }
  });
  const recoverableIds = staleJobs.filter((job) => job.attempts < job.maxAttempts).map((job) => job.id);
  const deadIds = staleJobs.filter((job) => job.attempts >= job.maxAttempts).map((job) => job.id);
  const [recovered, dead] = await prisma.$transaction([
    prisma.job.updateMany({
      where: {
        id: { in: recoverableIds },
        status: JobStatus.RUNNING,
        lockedAt: { lt: cutoff }
      },
      data: {
        status: JobStatus.PENDING,
        runAt: now,
        lockedAt: null,
        lockedBy: null,
        failedAt: null
      }
    }),
    prisma.job.updateMany({
      where: {
        id: { in: deadIds },
        status: JobStatus.RUNNING,
        lockedAt: { lt: cutoff }
      },
      data: {
        status: JobStatus.DEAD,
        lockedAt: null,
        lockedBy: null,
        failedAt: now,
        lastError: "Stale running job exceeded max attempts during recovery."
      }
    })
  ]);

  return {
    cutoff,
    dead: dead.count,
    recovered: recovered.count,
    runAt: now,
    staleAfterMs
  };
}

export async function getJobQueueStatus(options: unknown = {}): Promise<JobQueueStatus> {
  const input = objectInput(options);
  const now = normalizeOptionalJobDate(input.now, "Job status timestamp is invalid.");
  const activeWorkspaceWhere = activeJobWorkspaceWhere();
  const [statusGroups, duePendingCount, futurePendingCount, oldestDuePending, typeGroups] = await Promise.all([
    prisma.job.groupBy({
      by: ["status"],
      where: activeWorkspaceWhere,
      _count: { _all: true }
    }),
    prisma.job.count({
      where: {
        ...activeWorkspaceWhere,
        status: JobStatus.PENDING,
        runAt: { lte: now }
      }
    }),
    prisma.job.count({
      where: {
        ...activeWorkspaceWhere,
        status: JobStatus.PENDING,
        runAt: { gt: now }
      }
    }),
    prisma.job.findFirst({
      where: {
        ...activeWorkspaceWhere,
        status: JobStatus.PENDING,
        runAt: { lte: now }
      },
      orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
      select: { runAt: true }
    }),
    prisma.job.groupBy({
      by: ["type"],
      where: activeWorkspaceWhere,
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
  options: unknown = {}
): Promise<CleanupTerminalJobsResult> {
  const input = objectInput(options);
  const now = normalizeOptionalJobDate(input.now, "Job cleanup timestamp is invalid.");
  const retainSucceededDays = normalizeRetentionDays(
    input.retainSucceededDays,
    defaultRetainSucceededJobDays
  );
  const retainDeadDays = normalizeRetentionDays(input.retainDeadDays, defaultRetainDeadJobDays);
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

function normalizeEnqueueInput(input: unknown): Prisma.JobUncheckedCreateInput {
  const jobInput = objectInput(input);
  const type = normalizeJobType(jobInput.type);

  const dedupeKey = readNonEmpty(jobInput.dedupeKey ?? undefined);
  const workspaceId = normalizeOptionalJobWorkspaceId(jobInput.workspaceId);
  const maxAttempts = normalizeJobMaxAttempts(jobInput.maxAttempts);

  return {
    workspaceId,
    type,
    payload: normalizeJobPayload(jobInput.payload),
    maxAttempts,
    runAt: normalizeOptionalJobDate(jobInput.runAt, "Job run timestamp is invalid."),
    dedupeKey: dedupeKey ?? null
  };
}

function normalizeJobMaxAttempts(value: unknown): number {
  const maxAttempts = value ?? defaultMaxAttempts;
  if (typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ApiError("VALIDATION_ERROR", "Job maxAttempts must be a positive integer.", 422);
  }
  if (maxAttempts > jobMaxAttemptsMax) {
    throw new ApiError("VALIDATION_ERROR", "Job maxAttempts is too large.", 422);
  }

  return maxAttempts;
}

function normalizeJobPayload(value: unknown): Prisma.InputJsonValue {
  const normalized = normalizeJsonValue(value, new WeakSet<object>());
  return (normalized === null ? Prisma.JsonNull : normalized) as Prisma.InputJsonValue;
}

function normalizeJsonValue(value: unknown, seen: WeakSet<object>): NormalizedJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) throwInvalidJobPayload();
    seen.add(value);
    const normalized = value.map((item) => normalizeJsonValue(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (isPlainJsonObject(value)) {
    if (seen.has(value)) throwInvalidJobPayload();
    seen.add(value);
    const normalized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJsonValue(item, seen)])
    );
    seen.delete(value);
    return normalized;
  }

  throwInvalidJobPayload();
}

function throwInvalidJobPayload(): never {
  throw new ApiError("VALIDATION_ERROR", "Job payload must be JSON-compatible.", 422);
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJobType(value: unknown): string {
  const type = readNonEmpty(value);
  if (!type) throw new ApiError("VALIDATION_ERROR", "Job type is required.", 422);
  if (type.length > jobTypeMaxLength) {
    throw new ApiError("VALIDATION_ERROR", "Job type is too large.", 422);
  }
  if (!jobTypePattern.test(type)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Job type must use lowercase letters, numbers, dots, underscores, or hyphens.",
      422
    );
  }
  return type;
}

function normalizeOptionalJobWorkspaceId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Job workspace id must be text.", 422);
  }
  return value.trim() || null;
}

async function assertActiveJobWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { id: true }
  });

  if (!workspace) {
    throw new ApiError("NOT_FOUND", "Workspace was not found.", 404);
  }
}

function normalizeOptionalJobDate(value: unknown, message: string): Date {
  const date = value ?? new Date();
  assertValidJobDate(date, message);
  return date;
}

function assertValidJobDate(value: unknown, message: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
}

function normalizeClaimLimit(limit: unknown): number {
  const normalizedLimit = limit ?? 1;
  if (typeof normalizedLimit !== "number" || !Number.isInteger(normalizedLimit) || normalizedLimit < 1) {
    throw new ApiError("VALIDATION_ERROR", "Job claim limit must be a positive integer.", 422);
  }

  return Math.min(normalizedLimit, 100);
}

function normalizeStaleAfterMs(staleAfterMs: unknown): number {
  if (staleAfterMs === undefined) return defaultStaleJobAfterMs;
  if (typeof staleAfterMs !== "number" || !Number.isInteger(staleAfterMs) || staleAfterMs < 1) return defaultStaleJobAfterMs;
  return staleAfterMs;
}

function normalizeRetentionDays(value: unknown, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return defaultValue;
  return value;
}

function subtractDays(date: Date, days: number): Date {
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

function activeJobWorkspaceWhere(): Prisma.JobWhereInput {
  return { OR: [{ workspaceId: null }, { workspace: { deletedAt: null } }] };
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
  return redactSensitiveText(message)
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

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
