CREATE TABLE IF NOT EXISTS "AssistantConversation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantConversationMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "title" TEXT,
  "sources" JSONB,
  "draftActions" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AssistantConversation_workspaceId_userId_updatedAt_idx"
  ON "AssistantConversation"("workspaceId", "userId", "updatedAt");

CREATE INDEX IF NOT EXISTS "AssistantConversation_userId_updatedAt_idx"
  ON "AssistantConversation"("userId", "updatedAt");

CREATE INDEX IF NOT EXISTS "AssistantConversationMessage_workspaceId_conversationId_createdAt_idx"
  ON "AssistantConversationMessage"("workspaceId", "conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "AssistantConversationMessage_conversationId_createdAt_idx"
  ON "AssistantConversationMessage"("conversationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversation_workspaceId_fkey'
      AND conrelid = '"AssistantConversation"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversation"
      ADD CONSTRAINT "AssistantConversation_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversation_userId_fkey'
      AND conrelid = '"AssistantConversation"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversation"
      ADD CONSTRAINT "AssistantConversation_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversationMessage_workspaceId_fkey'
      AND conrelid = '"AssistantConversationMessage"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversationMessage"
      ADD CONSTRAINT "AssistantConversationMessage_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantConversationMessage_conversationId_fkey'
      AND conrelid = '"AssistantConversationMessage"'::regclass
  ) THEN
    ALTER TABLE "AssistantConversationMessage"
      ADD CONSTRAINT "AssistantConversationMessage_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
