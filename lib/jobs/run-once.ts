import type { Job } from "@prisma/client";

import {
  claimJobs,
  markJobFailedForRetry,
  markJobSucceeded
} from "@/lib/services/job-service";
import { jobHandlers, type JobHandlerRegistry } from "./handlers";

export type RunJobsOnceOptions = {
  handlers?: JobHandlerRegistry;
  limit?: number;
  now?: Date;
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
  const jobs = await claimJobs({
    limit: options.limit ?? 10,
    now,
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
    if (!handler) throw new Error(`No job handler registered for type: ${job.type}`);
    await handler({
      job: {
        attempts: job.attempts,
        id: job.id,
        maxAttempts: job.maxAttempts,
        type: job.type,
        workspaceId: job.workspaceId
      },
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
