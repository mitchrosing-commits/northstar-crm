-- Add explicit close outcome timestamps for future won/lost reporting and Goals v1.
-- Existing closed deals intentionally remain null because there is no reliable historical close date source.
ALTER TABLE "Deal"
ADD COLUMN "wonAt" TIMESTAMP(3),
ADD COLUMN "lostAt" TIMESTAMP(3);

CREATE INDEX "Deal_workspaceId_wonAt_idx" ON "Deal"("workspaceId", "wonAt");
CREATE INDEX "Deal_workspaceId_lostAt_idx" ON "Deal"("workspaceId", "lostAt");
