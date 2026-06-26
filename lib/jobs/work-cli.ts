import type { RunJobsWorkerOptions } from "./work";

type EnvInput = Record<string, string | undefined>;

export function readRunJobsWorkerCliOptions(env: EnvInput = process.env): Pick<
  RunJobsWorkerOptions,
  "idleExitAfterMs" | "limit" | "pollIntervalMs" | "staleAfterMs" | "workerId"
> {
  return {
    idleExitAfterMs: readNonNegativeInteger(env.JOBS_IDLE_EXIT_AFTER_MS),
    limit: readPositiveInteger(env.JOBS_BATCH_SIZE),
    pollIntervalMs: readPositiveInteger(env.JOBS_POLL_INTERVAL_MS),
    staleAfterMs: readPositiveInteger(env.JOBS_STALE_AFTER_MS),
    workerId: env.JOB_WORKER_ID
  };
}

function readPositiveInteger(rawValue: string | undefined) {
  if (!rawValue) return undefined;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) return undefined;

  return value;
}

function readNonNegativeInteger(rawValue: string | undefined) {
  if (!rawValue) return undefined;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) return undefined;

  return value;
}
