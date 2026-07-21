CREATE TABLE IF NOT EXISTS "AssistantConversationMemory" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "contextWindow" JSONB,
  "updatedFromMessageId" TEXT,
  "lastRebuiltAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantConversationMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantConversationReference" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "href" TEXT,
  "role" TEXT NOT NULL DEFAULT 'referenced',
  "reason" TEXT,
  "firstMessageId" TEXT,
  "lastMessageId" TEXT,
  "resultSetKey" TEXT NOT NULL DEFAULT 'conversation',
  "ordinal" INTEGER,
  "lastVerifiedAt" TIMESTAMP(3),
  "staleStatus" TEXT NOT NULL DEFAULT 'CURRENT',
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantConversationReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssistantConversationMemory_conversationId_key"
  ON "AssistantConversationMemory"("conversationId");

CREATE INDEX IF NOT EXISTS "AssistantConversationMemory_workspaceId_updatedAt_idx"
  ON "AssistantConversationMemory"("workspaceId", "updatedAt");

CREATE INDEX IF NOT EXISTS "AssistantConversationMemory_workspaceId_conversationId_idx"
  ON "AssistantConversationMemory"("workspaceId", "conversationId");

CREATE UNIQUE INDEX IF NOT EXISTS "AssistantConvRef_unique_workspace_conversation_record_role_key"
  ON "AssistantConversationReference"("workspaceId", "conversationId", "entityType", "recordId", "role", "resultSetKey");

CREATE INDEX IF NOT EXISTS "AssistantConvRef_workspace_conversation_role_updatedAt_idx"
  ON "AssistantConversationReference"("workspaceId", "conversationId", "role", "updatedAt");

CREATE INDEX IF NOT EXISTS "AssistantConvRef_workspace_conversation_resultSet_ordinal_idx"
  ON "AssistantConversationReference"("workspaceId", "conversationId", "resultSetKey", "ordinal");

CREATE INDEX IF NOT EXISTS "AssistantConvRef_workspace_entity_record_idx"
  ON "AssistantConversationReference"("workspaceId", "entityType", "recordId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversationMemory_workspaceId_fkey'
      AND conrelid = '"AssistantConversationMemory"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversationMemory"
      ADD CONSTRAINT "AssistantConversationMemory_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversationMemory_conversationId_fkey'
      AND conrelid = '"AssistantConversationMemory"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversationMemory"
      ADD CONSTRAINT "AssistantConversationMemory_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversationReference_workspaceId_fkey'
      AND conrelid = '"AssistantConversationReference"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversationReference"
      ADD CONSTRAINT "AssistantConversationReference_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversationReference_conversationId_fkey'
      AND conrelid = '"AssistantConversationReference"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversationReference"
      ADD CONSTRAINT "AssistantConversationReference_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
