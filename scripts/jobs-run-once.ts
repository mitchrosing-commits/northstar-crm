import { prisma } from "../lib/db/prisma";
import { formatRunJobsOnceSummary, readRunJobsOnceCliOptions } from "../lib/jobs/run-once-cli";
import { runJobsOnce } from "../lib/jobs/run-once";

async function main() {
  const result = await runJobsOnce(readRunJobsOnceCliOptions());

  console.log(formatRunJobsOnceSummary(result));
}

main()
  .catch(() => {
    console.error("Job batch failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
