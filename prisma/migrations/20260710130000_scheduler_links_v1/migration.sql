-- CreateTable
CREATE TABLE "SchedulerLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "meetingTitle" TEXT NOT NULL,
    "description" TEXT,
    "token" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "durationMinutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
    "availability" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SchedulerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerBooking" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "schedulerLinkId" TEXT NOT NULL,
    "activityId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "attendeeName" TEXT NOT NULL,
    "attendeeEmail" TEXT NOT NULL,
    "attendeeCompany" TEXT,
    "attendeeNote" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulerBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerLink_token_key" ON "SchedulerLink"("token");

-- CreateIndex
CREATE INDEX "SchedulerLink_workspaceId_idx" ON "SchedulerLink"("workspaceId");

-- CreateIndex
CREATE INDEX "SchedulerLink_workspaceId_isEnabled_idx" ON "SchedulerLink"("workspaceId", "isEnabled");

-- CreateIndex
CREATE INDEX "SchedulerLink_token_isEnabled_idx" ON "SchedulerLink"("token", "isEnabled");

-- CreateIndex
CREATE INDEX "SchedulerBooking_workspaceId_schedulerLinkId_requestedAt_idx" ON "SchedulerBooking"("workspaceId", "schedulerLinkId", "requestedAt");

-- CreateIndex
CREATE INDEX "SchedulerBooking_workspaceId_fingerprint_requestedAt_idx" ON "SchedulerBooking"("workspaceId", "fingerprint", "requestedAt");

-- CreateIndex
CREATE INDEX "SchedulerBooking_activityId_idx" ON "SchedulerBooking"("activityId");

-- AddForeignKey
ALTER TABLE "SchedulerLink" ADD CONSTRAINT "SchedulerLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulerLink" ADD CONSTRAINT "SchedulerLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulerBooking" ADD CONSTRAINT "SchedulerBooking_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulerBooking" ADD CONSTRAINT "SchedulerBooking_schedulerLinkId_fkey" FOREIGN KEY ("schedulerLinkId") REFERENCES "SchedulerLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulerBooking" ADD CONSTRAINT "SchedulerBooking_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
