CREATE TABLE IF NOT EXISTS "AssistantTodayItemHide" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "localDateKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantTodayItemHide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssistantTodayItemHide_workspaceId_userId_itemKey_localDateKey_key"
  ON "AssistantTodayItemHide"("workspaceId", "userId", "itemKey", "localDateKey");

CREATE INDEX IF NOT EXISTS "AssistantTodayItemHide_workspaceId_userId_localDateKey_idx"
  ON "AssistantTodayItemHide"("workspaceId", "userId", "localDateKey");

CREATE INDEX IF NOT EXISTS "AssistantTodayItemHide_userId_localDateKey_idx"
  ON "AssistantTodayItemHide"("userId", "localDateKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantTodayItemHide_workspaceId_fkey'
      AND conrelid = '"AssistantTodayItemHide"'::regclass
  ) THEN
    ALTER TABLE "AssistantTodayItemHide"
      ADD CONSTRAINT "AssistantTodayItemHide_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantTodayItemHide_userId_fkey'
      AND conrelid = '"AssistantTodayItemHide"'::regclass
  ) THEN
    ALTER TABLE "AssistantTodayItemHide"
      ADD CONSTRAINT "AssistantTodayItemHide_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
