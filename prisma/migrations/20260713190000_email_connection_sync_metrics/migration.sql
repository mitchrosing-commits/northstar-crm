-- Track safe, durable sync result metadata for connected email providers.
ALTER TABLE "EmailConnection"
  ADD COLUMN "lastSyncAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncImportedCount" INTEGER,
  ADD COLUMN "lastSyncDuplicateCount" INTEGER,
  ADD COLUMN "lastSyncSkippedCount" INTEGER,
  ADD COLUMN "lastSyncMessageSkipCount" INTEGER,
  ADD COLUMN "lastSyncTotalFetched" INTEGER,
  ADD COLUMN "lastSyncMode" TEXT;
