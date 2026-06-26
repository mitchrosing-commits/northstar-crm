-- Encrypted OAuth token storage foundation.
-- Only encrypted token payloads are stored; plaintext access/refresh tokens must never be persisted.

CREATE TABLE "EmailConnectionSecret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailConnectionProvider" NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "scopes" JSONB,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConnectionSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailConnectionSecret_connectionId_key" ON "EmailConnectionSecret"("connectionId");

CREATE INDEX "EmailConnectionSecret_workspaceId_provider_idx" ON "EmailConnectionSecret"("workspaceId", "provider");

CREATE INDEX "EmailConnectionSecret_workspaceId_accountEmail_idx" ON "EmailConnectionSecret"("workspaceId", "accountEmail");

CREATE INDEX "EmailConnectionSecret_userId_idx" ON "EmailConnectionSecret"("userId");

ALTER TABLE "EmailConnectionSecret" ADD CONSTRAINT "EmailConnectionSecret_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailConnectionSecret" ADD CONSTRAINT "EmailConnectionSecret_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailConnectionSecret" ADD CONSTRAINT "EmailConnectionSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
