-- Non-sensitive email connection status foundation.
-- OAuth access and refresh tokens are intentionally not stored until encrypted token storage exists.

CREATE TYPE "EmailConnectionProvider" AS ENUM ('GOOGLE_WORKSPACE', 'MICROSOFT_365', 'IMAP_SMTP');

CREATE TYPE "EmailConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'AUTH_REQUIRED', 'CONNECTED', 'DISCONNECTED', 'ERROR');

CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "EmailConnectionProvider" NOT NULL,
    "status" "EmailConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "accountEmail" TEXT,
    "displayName" TEXT,
    "scopes" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncCursor" TEXT,
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailConnection_workspaceId_provider_accountEmail_key" ON "EmailConnection"("workspaceId", "provider", "accountEmail");

CREATE INDEX "EmailConnection_workspaceId_provider_idx" ON "EmailConnection"("workspaceId", "provider");

CREATE INDEX "EmailConnection_workspaceId_status_idx" ON "EmailConnection"("workspaceId", "status");

CREATE INDEX "EmailConnection_createdById_idx" ON "EmailConnection"("createdById");

ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
