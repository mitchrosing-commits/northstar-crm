-- CreateTable
CREATE TABLE "MeetingActivityAssociation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "meetingIntakeId" TEXT,
    "dealId" TEXT,
    "leadId" TEXT,
    "personId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingActivityAssociation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MeetingActivityAssociation_exactly_one_target" CHECK (num_nonnulls("dealId", "leadId", "personId", "organizationId") = 1)
);

-- CreateIndex
CREATE INDEX "MeetingActivityAssociation_workspaceId_activityId_idx" ON "MeetingActivityAssociation"("workspaceId", "activityId");

-- CreateIndex
CREATE INDEX "MeetingActivityAssociation_workspaceId_meetingIntakeId_idx" ON "MeetingActivityAssociation"("workspaceId", "meetingIntakeId");

-- CreateIndex
CREATE INDEX "MeetingActivityAssociation_workspaceId_dealId_idx" ON "MeetingActivityAssociation"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "MeetingActivityAssociation_workspaceId_leadId_idx" ON "MeetingActivityAssociation"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "MeetingActivityAssociation_workspaceId_personId_idx" ON "MeetingActivityAssociation"("workspaceId", "personId");

-- CreateIndex
CREATE INDEX "MeetingActivityAssociation_workspaceId_organizationId_idx" ON "MeetingActivityAssociation"("workspaceId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingActivityAssociation_activityId_dealId_key" ON "MeetingActivityAssociation"("activityId", "dealId") WHERE "dealId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MeetingActivityAssociation_activityId_leadId_key" ON "MeetingActivityAssociation"("activityId", "leadId") WHERE "leadId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MeetingActivityAssociation_activityId_personId_key" ON "MeetingActivityAssociation"("activityId", "personId") WHERE "personId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MeetingActivityAssociation_activityId_organizationId_key" ON "MeetingActivityAssociation"("activityId", "organizationId") WHERE "organizationId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "MeetingActivityAssociation" ADD CONSTRAINT "MeetingActivityAssociation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActivityAssociation" ADD CONSTRAINT "MeetingActivityAssociation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActivityAssociation" ADD CONSTRAINT "MeetingActivityAssociation_meetingIntakeId_fkey" FOREIGN KEY ("meetingIntakeId") REFERENCES "MeetingIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActivityAssociation" ADD CONSTRAINT "MeetingActivityAssociation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActivityAssociation" ADD CONSTRAINT "MeetingActivityAssociation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActivityAssociation" ADD CONSTRAINT "MeetingActivityAssociation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActivityAssociation" ADD CONSTRAINT "MeetingActivityAssociation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
