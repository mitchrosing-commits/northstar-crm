ALTER TABLE "Quote" ADD COLUMN "sentDealValueCents" INTEGER;
ALTER TABLE "Quote" ADD COLUMN "sentDealCurrency" TEXT;
ALTER TABLE "Quote" ADD COLUMN "dealValueSyncedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "dealValueSyncConflict" TEXT;
CREATE INDEX "Quote_workspaceId_dealValueSyncedAt_idx" ON "Quote"("workspaceId", "dealValueSyncedAt");
