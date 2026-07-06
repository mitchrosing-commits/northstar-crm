-- Add saved smart-label snapshots for explicit AI email classification.
ALTER TABLE "EmailLog"
  ADD COLUMN "smartLabelJson" JSONB,
  ADD COLUMN "smartLabelProvider" TEXT,
  ADD COLUMN "smartLabelGeneratedAt" TIMESTAMP(3);

CREATE INDEX "EmailLog_workspaceId_smartLabelGeneratedAt_idx" ON "EmailLog"("workspaceId", "smartLabelGeneratedAt");
