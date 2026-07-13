-- CreateEnum
CREATE TYPE "CrmChangeProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmChangeProposalType" AS ENUM ('CREATE_PERSON', 'UPDATE_PERSON', 'CREATE_ORGANIZATION', 'UPDATE_ORGANIZATION', 'LINK_PERSON_ORGANIZATION');

-- CreateTable
CREATE TABLE "CrmChangeProposal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "appliedById" TEXT,
    "status" "CrmChangeProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposalType" "CrmChangeProposalType" NOT NULL,
    "targetEntityType" TEXT,
    "targetEntityId" TEXT,
    "appliedEntityType" TEXT,
    "appliedEntityId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceLabel" TEXT,
    "rationale" TEXT,
    "confidence" TEXT,
    "proposedPayload" JSONB NOT NULL,
    "currentSnapshot" JSONB,
    "duplicateCandidates" JSONB,
    "conflictInfo" JSONB,
    "evidence" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "CrmChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmChangeProposal_workspaceId_idempotencyKey_key" ON "CrmChangeProposal"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CrmChangeProposal_workspaceId_status_createdAt_idx" ON "CrmChangeProposal"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CrmChangeProposal_workspaceId_proposalType_status_idx" ON "CrmChangeProposal"("workspaceId", "proposalType", "status");

-- CreateIndex
CREATE INDEX "CrmChangeProposal_workspaceId_targetEntityType_targetEntityId_idx" ON "CrmChangeProposal"("workspaceId", "targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "CrmChangeProposal_createdById_status_idx" ON "CrmChangeProposal"("createdById", "status");

-- CreateIndex
CREATE INDEX "CrmChangeProposal_appliedById_idx" ON "CrmChangeProposal"("appliedById");

-- AddForeignKey
ALTER TABLE "CrmChangeProposal" ADD CONSTRAINT "CrmChangeProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmChangeProposal" ADD CONSTRAINT "CrmChangeProposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmChangeProposal" ADD CONSTRAINT "CrmChangeProposal_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
