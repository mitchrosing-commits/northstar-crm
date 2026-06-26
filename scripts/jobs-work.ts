import { prisma } from "../lib/db/prisma";
import { readRunJobsWorkerCliOptions } from "../lib/jobs/work-cli";
import {
  formatRunJobsWorkerBatchSummary,
  formatRunJobsWorkerSummary,
  formatStaleRecoverySummary,
  runJobsWorker
} from "../lib/jobs/work";

const abortController = new AbortController();
let shutdownRequested = false;

function requestShutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log("Job worker shutdown requested.");
  abortController.abort();
}

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);

async function main() {
  console.log("Job worker started.");
  const result = await runJobsWorker({
    ...readRunJobsWorkerCliOptions(),
    signal: abortController.signal,
    onRecoveryResult: (recovery) => {
      if (recovery.recovered > 0) {
        console.log(formatStaleRecoverySummary(recovery));
      }
    },
    onBatchResult: (batch) => {
      if (batch.claimed > 0) {
        console.log(formatRunJobsWorkerBatchSummary(batch));
      }
    }
  });

  console.log(formatRunJobsWorkerSummary(result));
}

main()
  .catch(() => {
    console.error("Job worker failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    await prisma.$disconnect();
  });
