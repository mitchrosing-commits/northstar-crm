import type { CleanupTerminalJobsInput, CleanupTerminalJobsResult } from "@/lib/services/job-service";

type EnvInput = Record<string, string | undefined>;

export function readCleanupTerminalJobsCliOptions(env: EnvInput = process.env): Pick<
  CleanupTerminalJobsInput,
  "retainDeadDays" | "retainSucceededDays"
> {
  return {
    retainDeadDays: readPositiveInteger(env.JOBS_RETAIN_DEAD_DAYS),
    retainSucceededDays: readPositiveInteger(env.JOBS_RETAIN_SUCCEEDED_DAYS)
  };
}

export function formatCleanupTerminalJobsSummary(result: CleanupTerminalJobsResult) {
  return [
    "Job cleanup complete",
    `deletedSucceeded=${result.deletedSucceeded}`,
    `deletedDead=${result.deletedDead}`,
    `totalDeleted=${result.totalDeleted}`,
    `retainSucceededDays=${result.retainSucceededDays}`,
    `retainDeadDays=${result.retainDeadDays}`,
    `succeededCutoff=${result.succeededCutoff.toISOString()}`,
    `deadCutoff=${result.deadCutoff.toISOString()}`
  ].join("\n");
}

function readPositiveInteger(rawValue: string | undefined) {
  if (!rawValue) return undefined;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) return undefined;

  return value;
}
