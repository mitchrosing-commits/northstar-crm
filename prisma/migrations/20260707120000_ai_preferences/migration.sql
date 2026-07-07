CREATE TABLE "AiPreference" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emailSummaryLength" TEXT NOT NULL DEFAULT 'short',
  "recordSummaryStyle" TEXT NOT NULL DEFAULT 'balanced',
  "replyTone" TEXT NOT NULL DEFAULT 'warm',
  "assistantDetailLevel" TEXT NOT NULL DEFAULT 'balanced',
  "diagnosticsDetailLevel" TEXT NOT NULL DEFAULT 'simple',
  "relationshipMemoryUsage" TEXT NOT NULL DEFAULT 'conservative',
  "meetingIntelligenceNoteStyle" TEXT NOT NULL DEFAULT 'structured',
  "suggestionAggressiveness" TEXT NOT NULL DEFAULT 'medium',
  "naturalLanguageInstructions" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiPreference_workspaceId_userId_key" ON "AiPreference"("workspaceId", "userId");
CREATE INDEX "AiPreference_userId_idx" ON "AiPreference"("userId");

ALTER TABLE "AiPreference"
  ADD CONSTRAINT "AiPreference_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiPreference"
  ADD CONSTRAINT "AiPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
