-- Add workspace-level monthly won-revenue goal targets.
CREATE TYPE "GoalType" AS ENUM ('WON_REVENUE');

CREATE TABLE "Goal" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" "GoalType" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL,
  "targetCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Goal_workspaceId_type_currency_periodStart_key" ON "Goal"("workspaceId", "type", "currency", "periodStart");
CREATE INDEX "Goal_workspaceId_type_periodStart_idx" ON "Goal"("workspaceId", "type", "periodStart");
CREATE INDEX "Goal_workspaceId_currency_periodStart_idx" ON "Goal"("workspaceId", "currency", "periodStart");

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
