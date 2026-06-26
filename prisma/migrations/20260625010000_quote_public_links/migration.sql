CREATE TABLE "QuotePublicLink" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuotePublicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuotePublicLink_token_key" ON "QuotePublicLink"("token");
CREATE INDEX "QuotePublicLink_workspaceId_quoteId_idx" ON "QuotePublicLink"("workspaceId", "quoteId");
CREATE INDEX "QuotePublicLink_token_revokedAt_idx" ON "QuotePublicLink"("token", "revokedAt");

ALTER TABLE "QuotePublicLink" ADD CONSTRAINT "QuotePublicLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuotePublicLink" ADD CONSTRAINT "QuotePublicLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
