CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TABLE "EmailLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT,
  "dealId" TEXT,
  "leadId" TEXT,
  "personId" TEXT,
  "organizationId" TEXT,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "direction" "EmailDirection" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "fromText" TEXT,
  "toText" TEXT,
  "ccText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailTemplate" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailLog_workspaceId_occurredAt_idx" ON "EmailLog"("workspaceId", "occurredAt");
CREATE INDEX "EmailLog_workspaceId_dealId_idx" ON "EmailLog"("workspaceId", "dealId");
CREATE INDEX "EmailLog_workspaceId_leadId_idx" ON "EmailLog"("workspaceId", "leadId");
CREATE INDEX "EmailLog_workspaceId_personId_idx" ON "EmailLog"("workspaceId", "personId");
CREATE INDEX "EmailLog_workspaceId_organizationId_idx" ON "EmailLog"("workspaceId", "organizationId");
CREATE INDEX "EmailTemplate_workspaceId_active_idx" ON "EmailTemplate"("workspaceId", "active");
CREATE INDEX "EmailTemplate_workspaceId_name_idx" ON "EmailTemplate"("workspaceId", "name");

ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
