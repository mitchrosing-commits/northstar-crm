-- Add the first background job foundation table.
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');

CREATE TABLE "Job" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "processedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");
CREATE INDEX "Job_lockedAt_idx" ON "Job"("lockedAt");
CREATE INDEX "Job_workspaceId_idx" ON "Job"("workspaceId");
CREATE INDEX "Job_type_dedupeKey_status_idx" ON "Job"("type", "dedupeKey", "status");

-- Prisma does not model partial unique indexes. Keep active dedupe uniqueness in SQL
-- so SUCCEEDED/DEAD jobs do not block a later intentionally re-enqueued job.
CREATE UNIQUE INDEX "Job_active_type_dedupeKey_key"
  ON "Job"("type", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL AND "status" IN ('PENDING', 'RUNNING', 'FAILED');

ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
