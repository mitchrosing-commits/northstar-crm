import { JobStatus } from "@prisma/client";

import { internalNoopJobType, passwordResetEmailJobType } from "./handlers";
import type { JobQueueStatus } from "@/lib/services/job-service";

const statusOrder = [
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.DEAD
] as const;
const safeJobTypes = [passwordResetEmailJobType, internalNoopJobType] as const;

export function formatJobQueueStatus(status: JobQueueStatus) {
  const lines = [
    "Job queue status",
    `total=${status.total}`,
    ...statusOrder.map((jobStatus) => `${jobStatus.toLowerCase()}=${status.byStatus[jobStatus]}`),
    `duePending=${status.duePendingCount}`,
    `futurePending=${status.futurePendingCount}`,
    `oldestDuePendingRunAt=${status.oldestDuePendingRunAt?.toISOString() ?? "none"}`
  ];

  const typeLines = formatTypeCountLines(status.typeCounts);

  if (typeLines.length > 0) {
    lines.push("types:");
    lines.push(...typeLines);
  }

  return lines.join("\n");
}

function formatTypeCountLines(typeCounts: JobQueueStatus["typeCounts"]) {
  const lines: string[] = [];
  let unregisteredCount = 0;

  for (const typeCount of typeCounts) {
    if (isSafeJobType(typeCount.type)) {
      lines.push(`  ${typeCount.type}=${typeCount.count}`);
    } else {
      unregisteredCount += typeCount.count;
    }
  }

  if (unregisteredCount > 0) {
    lines.push(`  unregistered=${unregisteredCount}`);
  }

  return lines;
}

function isSafeJobType(type: string): type is (typeof safeJobTypes)[number] {
  return safeJobTypes.includes(type as (typeof safeJobTypes)[number]);
}
