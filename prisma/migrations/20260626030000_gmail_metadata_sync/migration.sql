-- Gmail metadata sync v0.
-- Provider message identifiers are stored for dedupe; raw Gmail payloads and bodies are not stored.

ALTER TABLE "EmailLog" ADD COLUMN "provider" "EmailConnectionProvider";
ALTER TABLE "EmailLog" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "providerThreadId" TEXT;

CREATE UNIQUE INDEX "EmailLog_workspaceId_provider_providerMessageId_key" ON "EmailLog"("workspaceId", "provider", "providerMessageId");
