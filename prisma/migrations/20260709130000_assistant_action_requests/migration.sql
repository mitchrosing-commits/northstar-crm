/* Persist review-first Assistant action requests without adding an apply path. */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssistantActionRequestStatus') THEN
    CREATE TYPE "AssistantActionRequestStatus" AS ENUM ('PENDING', 'REJECTED', 'APPLIED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AssistantActionRequest" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT,
  "status" "AssistantActionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "actionType" TEXT NOT NULL,
  "objectType" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "confidence" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "targetLabel" TEXT NOT NULL,
  "targetHref" TEXT,
  "sourceSummary" TEXT,
  "proposedPayload" JSONB NOT NULL,
  "evidence" JSONB,
  "warnings" JSONB,
  "missingInfo" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rejectedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "AssistantActionRequest_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantActionRequest_workspaceId_fkey'
      AND conrelid = '"AssistantActionRequest"'::regclass
  ) THEN
    ALTER TABLE "AssistantActionRequest"
      ADD CONSTRAINT "AssistantActionRequest_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantActionRequest_createdById_fkey'
      AND conrelid = '"AssistantActionRequest"'::regclass
  ) THEN
    ALTER TABLE "AssistantActionRequest"
      ADD CONSTRAINT "AssistantActionRequest_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AssistantActionRequest_workspaceId_status_createdAt_idx" ON "AssistantActionRequest"("workspaceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantActionRequest_workspaceId_createdById_status_idx" ON "AssistantActionRequest"("workspaceId", "createdById", "status");
CREATE INDEX IF NOT EXISTS "AssistantActionRequest_createdById_status_idx" ON "AssistantActionRequest"("createdById", "status");
