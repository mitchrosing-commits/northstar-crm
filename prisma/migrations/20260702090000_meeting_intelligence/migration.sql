CREATE TYPE "MeetingIntakeSourceType" AS ENUM (
  'PASTED_TEXT',
  'MARKDOWN',
  'TEXT_FILE',
  'PDF',
  'DOCX',
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'UNSUPPORTED'
);

CREATE TYPE "MeetingIntakeStatus" AS ENUM (
  'DRAFT',
  'EXTRACTING',
  'EXTRACTED',
  'ANALYZING',
  'READY_FOR_REVIEW',
  'APPLIED',
  'FAILED'
);

CREATE TABLE "MeetingIntake" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT,
  "sourceType" "MeetingIntakeSourceType" NOT NULL,
  "originalFilename" TEXT,
  "originalMimeType" TEXT,
  "contextText" TEXT,
  "rawText" TEXT,
  "markdownText" TEXT,
  "status" "MeetingIntakeStatus" NOT NULL DEFAULT 'DRAFT',
  "analysisJson" JSONB,
  "proposedChangesJson" JSONB,
  "applyResultJson" JSONB,
  "errorMessage" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingIntake_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeetingIntake_workspaceId_status_idx" ON "MeetingIntake"("workspaceId", "status");
CREATE INDEX "MeetingIntake_workspaceId_createdAt_idx" ON "MeetingIntake"("workspaceId", "createdAt");
CREATE INDEX "MeetingIntake_createdById_idx" ON "MeetingIntake"("createdById");

ALTER TABLE "MeetingIntake" ADD CONSTRAINT "MeetingIntake_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeetingIntake" ADD CONSTRAINT "MeetingIntake_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
