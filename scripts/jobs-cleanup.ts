import { prisma } from "../lib/db/prisma";
import {
  formatCleanupTerminalJobsSummary,
  readCleanupTerminalJobsCliOptions
} from "../lib/jobs/cleanup-cli";
import { cleanupTerminalJobs } from "../lib/services/job-service";

async function main() {
  const result = await cleanupTerminalJobs(readCleanupTerminalJobsCliOptions());

  console.log(formatCleanupTerminalJobsSummary(result));
}

main()
  .catch(() => {
    console.error("Job cleanup failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
