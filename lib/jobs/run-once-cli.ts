import type { RunJobsOnceOptions, RunJobsOnceResult } from "./run-once";

type EnvInput = Record<string, string | undefined>;

export function readRunJobsOnceCliOptions(env: EnvInput = process.env): Pick<RunJobsOnceOptions, "limit" | "workerId"> {
  return {
    limit: readBatchSize(env.JOBS_BATCH_SIZE),
    workerId: env.JOB_WORKER_ID
  };
}

export function formatRunJobsOnceSummary(result: RunJobsOnceResult) {
  return `Processed one job batch: claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} dead=${result.dead}`;
}

function readBatchSize(rawValue: string | undefined) {
  if (!rawValue) return undefined;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) return undefined;

  return value;
}
