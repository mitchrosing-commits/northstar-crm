import { formatRunJobsOnceSummary } from "./run-once-cli";
import { runJobsOnce, type RunJobsOnceOptions, type RunJobsOnceResult } from "./run-once";
import {
  defaultStaleJobAfterMs,
  recoverStaleRunningJobs,
  type RecoverStaleRunningJobsResult
} from "@/lib/services/job-service";

export const defaultJobsWorkerPollIntervalMs = 5000;
export const defaultJobsStaleAfterMs = defaultStaleJobAfterMs;

export type RunJobsWorkerOptions = Omit<RunJobsOnceOptions, "workerId"> & {
  idleExitAfterMs?: number;
  onRecoveryResult?: (result: RecoverStaleRunningJobsResult) => void;
  onBatchResult?: (result: RunJobsOnceResult) => void;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  staleAfterMs?: number;
  workerId?: string;
};

export type RunJobsWorkerResult = RunJobsOnceResult & {
  batches: number;
  recovered: number;
  stopped: boolean;
};

export async function runJobsWorker(options: RunJobsWorkerOptions = {}): Promise<RunJobsWorkerResult> {
  const signal = options.signal;
  const sleep = options.sleep ?? sleepWithAbort;
  const workerId = normalizeJobsWorkerId(options.workerId);
  const pollIntervalMs = normalizePollIntervalMs(options.pollIntervalMs);
  const idleExitAfterMs = normalizeIdleExitAfterMs(options.idleExitAfterMs);
  const staleAfterMs = normalizeStaleAfterMs(options.staleAfterMs);
  const result: RunJobsWorkerResult = {
    batches: 0,
    claimed: 0,
    dead: 0,
    failed: 0,
    recovered: 0,
    stopped: false,
    succeeded: 0
  };
  let lastWorkAt = Date.now();

  while (!signal?.aborted) {
    const recovery = await recoverStaleRunningJobs({ now: options.now, staleAfterMs });
    result.dead += recovery.dead;
    result.recovered += recovery.recovered;
    options.onRecoveryResult?.(recovery);

    const batch = await runJobsOnce({
      autoEnqueueGmailSync: options.autoEnqueueGmailSync,
      handlers: options.handlers,
      limit: options.limit,
      now: options.now,
      types: options.types,
      workspaceId: options.workspaceId,
      workerId
    });

    result.batches += 1;
    result.claimed += batch.claimed;
    result.succeeded += batch.succeeded;
    result.failed += batch.failed;
    result.dead += batch.dead;
    options.onBatchResult?.(batch);

    if (batch.claimed > 0) {
      lastWorkAt = Date.now();
    } else if (idleExitAfterMs !== undefined && Date.now() - lastWorkAt >= idleExitAfterMs) {
      break;
    }

    if (signal?.aborted) break;
    await sleep(pollIntervalMs, signal);
  }

  result.stopped = Boolean(signal?.aborted);
  return result;
}

export function normalizeJobsWorkerId(workerId: string | undefined, processId = process.pid): string {
  const trimmed = workerId?.trim();
  return trimmed || `jobs-work-${processId}`;
}

export function normalizePollIntervalMs(value: number | undefined): number {
  if (value === undefined) return defaultJobsWorkerPollIntervalMs;
  if (!Number.isInteger(value) || value < 1) return defaultJobsWorkerPollIntervalMs;
  return value;
}

export function normalizeStaleAfterMs(value: number | undefined): number {
  if (value === undefined) return defaultJobsStaleAfterMs;
  if (!Number.isInteger(value) || value < 1) return defaultJobsStaleAfterMs;
  return value;
}

export function normalizeIdleExitAfterMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}

export function formatRunJobsWorkerSummary(result: RunJobsWorkerResult) {
  return `Job worker stopped: batches=${result.batches} recovered=${result.recovered} claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} dead=${result.dead}`;
}

export function formatRunJobsWorkerBatchSummary(result: RunJobsOnceResult) {
  return formatRunJobsOnceSummary(result);
}

export function formatStaleRecoverySummary(result: RecoverStaleRunningJobsResult) {
  return `Recovered stale running jobs: recovered=${result.recovered} dead=${result.dead}`;
}

function sleepWithAbort(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, ms);

    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    }

    signal?.addEventListener("abort", done, { once: true });
  });
}
