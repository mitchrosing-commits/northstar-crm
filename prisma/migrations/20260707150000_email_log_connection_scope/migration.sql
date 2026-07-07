/* Scope synced email logs to the exact provider connection that imported/sent them. */
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "emailConnectionId" TEXT;

UPDATE "EmailLog" AS log
SET "emailConnectionId" = connection.id
FROM "EmailConnection" AS connection
WHERE log."workspaceId" = connection."workspaceId"
  AND log.provider = connection.provider
  AND log.provider IS NOT NULL
  AND log."providerMessageId" IS NOT NULL
  AND connection."deletedAt" IS NULL
  AND connection.id = (
    SELECT candidate.id
    FROM "EmailConnection" AS candidate
    WHERE candidate."workspaceId" = log."workspaceId"
      AND candidate.provider = log.provider
      AND candidate."deletedAt" IS NULL
    ORDER BY candidate."updatedAt" DESC
    LIMIT 1
  )
  AND (
    SELECT COUNT(*)
    FROM "EmailConnection" AS candidate_count
    WHERE candidate_count."workspaceId" = log."workspaceId"
      AND candidate_count.provider = log.provider
      AND candidate_count."deletedAt" IS NULL
  ) = 1;

DROP INDEX IF EXISTS "EmailLog_workspaceId_provider_providerMessageId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmailLog_workspaceId_provider_emailConnectionId_providerMessageId_key" ON "EmailLog"("workspaceId", "provider", "emailConnectionId", "providerMessageId");
CREATE INDEX IF NOT EXISTS "EmailLog_workspaceId_emailConnectionId_idx" ON "EmailLog"("workspaceId", "emailConnectionId");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'EmailLog_emailConnectionId_fkey'
      AND conrelid = '"EmailLog"'::regclass
  ) THEN
    ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId") REFERENCES "EmailConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "EmailConnection_workspaceId_provider_accountEmail_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmailConnection_workspaceId_provider_accountEmail_createdById_key" ON "EmailConnection"("workspaceId", "provider", "accountEmail", "createdById");
