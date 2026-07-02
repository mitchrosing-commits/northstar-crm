-- CreateEnum
CREATE TYPE "ContractStepType" AS ENUM ('NDA', 'MSA', 'SOW');

-- CreateEnum
CREATE TYPE "ContractStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SENT', 'SIGNED', 'BLOCKED', 'SKIPPED');

-- CreateTable
CREATE TABLE "DealContractStep" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "ownerId" TEXT,
    "type" "ContractStepType" NOT NULL,
    "status" "ContractStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "notes" TEXT,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DealContractStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealContractStep_workspaceId_dealId_type_key" ON "DealContractStep"("workspaceId", "dealId", "type");

-- CreateIndex
CREATE INDEX "DealContractStep_workspaceId_dealId_idx" ON "DealContractStep"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "DealContractStep_workspaceId_ownerId_idx" ON "DealContractStep"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "DealContractStep_workspaceId_status_idx" ON "DealContractStep"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "DealContractStep" ADD CONSTRAINT "DealContractStep_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealContractStep" ADD CONSTRAINT "DealContractStep_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealContractStep" ADD CONSTRAINT "DealContractStep_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
