-- CreateTable
CREATE TABLE "WebForm" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "publicTitle" TEXT NOT NULL,
    "publicDescription" TEXT,
    "token" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceLabel" TEXT NOT NULL,
    "requireLeadTitle" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WebForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebFormSubmission" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "webFormId" TEXT NOT NULL,
    "leadId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebForm_token_key" ON "WebForm"("token");

-- CreateIndex
CREATE INDEX "WebForm_workspaceId_idx" ON "WebForm"("workspaceId");

-- CreateIndex
CREATE INDEX "WebForm_workspaceId_isEnabled_idx" ON "WebForm"("workspaceId", "isEnabled");

-- CreateIndex
CREATE INDEX "WebForm_token_isEnabled_idx" ON "WebForm"("token", "isEnabled");

-- CreateIndex
CREATE INDEX "WebFormSubmission_workspaceId_webFormId_submittedAt_idx" ON "WebFormSubmission"("workspaceId", "webFormId", "submittedAt");

-- CreateIndex
CREATE INDEX "WebFormSubmission_workspaceId_fingerprint_submittedAt_idx" ON "WebFormSubmission"("workspaceId", "fingerprint", "submittedAt");

-- CreateIndex
CREATE INDEX "WebFormSubmission_leadId_idx" ON "WebFormSubmission"("leadId");

-- AddForeignKey
ALTER TABLE "WebForm" ADD CONSTRAINT "WebForm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebForm" ADD CONSTRAINT "WebForm_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebFormSubmission" ADD CONSTRAINT "WebFormSubmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebFormSubmission" ADD CONSTRAINT "WebFormSubmission_webFormId_fkey" FOREIGN KEY ("webFormId") REFERENCES "WebForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebFormSubmission" ADD CONSTRAINT "WebFormSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
