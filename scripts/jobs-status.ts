import { prisma } from "../lib/db/prisma";
import { formatJobQueueStatus } from "../lib/jobs/status-cli";
import { getJobQueueStatus } from "../lib/services/job-service";

async function main() {
  const status = await getJobQueueStatus();

  console.log(formatJobQueueStatus(status));
}

main()
  .catch(() => {
    console.error("Job queue status failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
