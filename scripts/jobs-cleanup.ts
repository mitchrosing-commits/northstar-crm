import { prisma } from "../lib/db/prisma";
import {
  formatCleanupTerminalJobsSummary,
  formatMeetingIntelligenceStoredFilesCleanupSummary,
  readCleanupTerminalJobsCliOptions
} from "../lib/jobs/cleanup-cli";
import { cleanupTerminalJobs } from "../lib/services/job-service";
import { cleanupMeetingIntelligenceStoredFiles } from "../lib/services/meeting-intelligence-service";

async function main() {
  const jobsResult = await cleanupTerminalJobs(readCleanupTerminalJobsCliOptions());
  const storedFilesResult = await cleanupMeetingIntelligenceStoredFiles();

  console.log(formatCleanupTerminalJobsSummary(jobsResult));
  console.log(formatMeetingIntelligenceStoredFilesCleanupSummary(storedFilesResult));
}

main()
  .catch(() => {
    console.error("Job cleanup failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
