import type { Job } from "@prisma/client";

import {
  claimJobs,
  markJobFailedForRetry,
  markJobSucceeded
} from "@/lib/services/job-service";
import {
  enqueueDueGmailInboxSyncJobs,
  gmailInboxSyncJobType
} from "@/lib/services/email-connection-service";
import { jobHandlers, type JobHandlerRegistry } from "./handlers";

export type RunJobsOnceOptions = {
  autoEnqueueGmailSync?: boolean;
  handlers?: JobHandlerRegistry;
  limit?: number;
  now?: Date;
  types?: unknown;
  workspaceId?: unknown;
  workerId?: string;
};

export type RunJobsOnceResult = {
  claimed: number;
  dead: number;
  failed: number;
  succeeded: number;
};

export async function runJobsOnce(options: RunJobsOnceOptions = {}): Promise<RunJobsOnceResult> {
  const now = options.now ?? new Date();
  const workerId = normalizeRunOnceWorkerId(options.workerId);
  const handlers = options.handlers ?? jobHandlers;
  if (shouldAutoEnqueueGmailSync(options)) {
    await enqueueDueGmailInboxSyncJobs({
      now,
      workspaceId: normalizeAutoSyncWorkspaceId(options.workspaceId)
    });
  }
  const jobs = await claimJobs({
    limit: options.limit ?? 10,
    now,
    types: options.types,
    workspaceId: options.workspaceId,
    workerId
  });
  const result: RunJobsOnceResult = {
    claimed: jobs.length,
    dead: 0,
    failed: 0,
    succeeded: 0
  };

  for (const job of jobs) {
    await processClaimedJob(job, handlers, now, result);
  }

  return result;
}

async function processClaimedJob(
  job: Job,
  handlers: JobHandlerRegistry,
  now: Date,
  result: RunJobsOnceResult
) {
  const handler = handlers[job.type];

  try {
    if (!handler) throw new Error("No job handler registered.");
    await handler({
      job: {
        attempts: job.attempts,
        id: job.id,
        maxAttempts: job.maxAttempts,
        type: job.type,
        workspaceId: job.workspaceId
      },
      now,
      payload: job.payload
    });
    await markJobSucceeded(job.id, now);
    result.succeeded += 1;
  } catch (error) {
    const failedJob = await markJobFailedForRetry(job.id, error, { now });
    if (failedJob.status === "DEAD") {
      result.dead += 1;
    } else {
      result.failed += 1;
    }
  }
}

export function normalizeRunOnceWorkerId(workerId: string | undefined, processId = process.pid) {
  const trimmed = workerId?.trim();
  return trimmed || defaultRunOnceWorkerId(processId);
}

export function defaultRunOnceWorkerId(processId = process.pid) {
  return `jobs-run-once-${processId}`;
}

function shouldAutoEnqueueGmailSync(options: RunJobsOnceOptions) {
  if (options.autoEnqueueGmailSync === false) return false;
  if (!jobTypesIncludeGmailSync(options.types)) return false;
  return Boolean(options.handlers?.[gmailInboxSyncJobType] ?? jobHandlers[gmailInboxSyncJobType]);
}

function jobTypesIncludeGmailSync(types: unknown) {
  if (types === undefined || types === null || types === "") return true;
  if (typeof types === "string") return types === gmailInboxSyncJobType;
  if (Array.isArray(types)) return types.includes(gmailInboxSyncJobType);
  return false;
}

function normalizeAutoSyncWorkspaceId(workspaceId: unknown) {
  return typeof workspaceId === "string" && workspaceId.trim()
    ? workspaceId.trim()
    : undefined;
}
