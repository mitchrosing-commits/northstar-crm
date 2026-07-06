-- CreateTable
CREATE TABLE "EmailLogActivityLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailLogId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLogActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailLogActivityLink_emailLogId_activityId_key" ON "EmailLogActivityLink"("emailLogId", "activityId");

-- CreateIndex
CREATE INDEX "EmailLogActivityLink_workspaceId_emailLogId_idx" ON "EmailLogActivityLink"("workspaceId", "emailLogId");

-- CreateIndex
CREATE INDEX "EmailLogActivityLink_workspaceId_activityId_idx" ON "EmailLogActivityLink"("workspaceId", "activityId");

-- AddForeignKey
ALTER TABLE "EmailLogActivityLink" ADD CONSTRAINT "EmailLogActivityLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLogActivityLink" ADD CONSTRAINT "EmailLogActivityLink_emailLogId_fkey" FOREIGN KEY ("emailLogId") REFERENCES "EmailLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLogActivityLink" ADD CONSTRAINT "EmailLogActivityLink_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
