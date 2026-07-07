import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const validators = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/services/deal-service.ts"), "utf8");
const closeOutcomeMigration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260625040000_deal_close_outcome_timestamps/migration.sql"),
  "utf8"
);
const detailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const editPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/edit/page.tsx"), "utf8");
const closeActions = readFileSync(join(process.cwd(), "components/deal-close-actions.tsx"), "utf8");
const dealForm = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");
const pipelineBoard = readFileSync(join(process.cwd(), "components/pipeline-board.tsx"), "utf8");
const pipelineMoveControl = readFileSync(join(process.cwd(), "components/pipeline-stage-move-control.tsx"), "utf8");
const recordHeaderActions = readFileSync(join(process.cwd(), "components/record-header-actions.tsx"), "utf8");

describe("deal close behavior", () => {
  it("routes deal close actions through a validated workspace endpoint", () => {
    expect(route).toContain("nestedResource === \"close\"");
    expect(route).toContain("nestedResource === \"reopen\"");
    expect(route).toContain("closeDealSchema.parse");
    expect(route).toContain("closeDeal(actor, idOrNested");
    expect(route).toContain("reopenDeal(actor, idOrNested)");
    expect(validators).toContain("export const closeDealSchema");
  });

  it("marks deals won or lost without changing pipeline or stage", () => {
    expect(service).toContain("export async function closeDeal");
    expect(service).toContain("pipelineId: existing.pipelineId");
    expect(service).toContain("stageId: existing.stageId");
    expect(closeActions).toContain("status: statusToSet");
    expect(closeActions).toContain("Mark won");
    expect(closeActions).toContain("Mark lost");
  });

  it("persists close outcome timestamps for future reporting without backfilling history", () => {
    expect(schema).toMatch(/wonAt\s+DateTime\?/);
    expect(schema).toMatch(/lostAt\s+DateTime\?/);
    expect(schema).toContain("@@index([workspaceId, wonAt])");
    expect(schema).toContain("@@index([workspaceId, lostAt])");
    expect(closeOutcomeMigration).toContain("ADD COLUMN \"wonAt\" TIMESTAMP(3)");
    expect(closeOutcomeMigration).toContain("ADD COLUMN \"lostAt\" TIMESTAMP(3)");
    expect(closeOutcomeMigration).toContain("Existing closed deals intentionally remain null");
  });

  it("sets outcome timestamps on close and clears them on reopen", () => {
    expect(service).toContain("const outcomeAt = new Date()");
    expect(service).toContain("const status = normalizeCloseDealStatus(data.status)");
    expect(service).toContain("const lostReason = normalizeCloseDealLostReason(data.lostReason, status)");
    expect(service).toContain("Deal close status must be WON or LOST.");
    expect(service).toContain("Deal lost reason must be text.");
    expect(service).toContain("{ status, wonAt: outcomeAt, lostAt: null }");
    expect(service).toContain("{ status, wonAt: null, lostAt: outcomeAt }");
    expect(service).toContain("data: { status: \"OPEN\", wonAt: null, lostAt: null }");
  });

  it("reopens won or lost deals through a focused workspace action", () => {
    expect(service).toContain("export async function reopenDeal");
    expect(service).toContain("existing.status === \"OPEN\"");
    expect(service).toContain("DEAL_ALREADY_OPEN");
    expect(service).toContain("data: { status: \"OPEN\", wonAt: null, lostAt: null }");
    expect(service).toContain("deal.reopened");
    expect(service).toContain("previousStatus: existing.status");
    expect(closeActions).toContain("/api/v1/workspaces/${workspaceId}/deals/${dealId}/reopen");
    expect(closeActions).toContain("Reopen deal");
    expect(closeActions).toContain("window.confirm");
    expect(closeActions).toContain("import { ActionGroup }");
    expect(closeActions).toContain('const closedDealActionsLabel = "Closed deal actions";');
    expect(closeActions).toContain('const reopenDealActionLabel = "Reopen deal for editing and stage movement";');
    expect(closeActions).toContain('<ActionGroup className="form-actions" label={closedDealActionsLabel}>');
    expect(closeActions).toContain("aria-label={reopenDealActionLabel}");
    expect(closeActions).toContain("title={reopenDealActionLabel}");
    expect(closeActions).toContain("button-primary button-compact");
  });

  it("shows reopen only for closed deals while preserving normal open close actions", () => {
    expect(closeActions).toContain("if (status !== \"OPEN\")");
    expect(closeActions).toContain("LockedPanelNotice");
    expect(closeActions).toContain("title=\"Deal closed\"");
    expect(closeActions).toContain("Reopen it to edit the deal or move it between stages.");
    expect(closeActions).not.toContain("<p className=\"empty-copy\">This deal is closed. Reopen it to edit the deal or move it between stages.</p>");
    expect(closeActions).toContain("Mark won");
    expect(closeActions).toContain("Mark lost");
    expect(closeActions).toContain('const markWonActionsLabel = "Mark deal won";');
    expect(closeActions).toContain('const markLostActionsLabel = "Mark deal lost";');
    expect(closeActions).toContain('const markWonActionLabel = "Mark deal as won";');
    expect(closeActions).toContain('const markLostActionLabel = "Mark deal as lost";');
    expect(closeActions).toContain('<ActionGroup className="form-actions" label={markWonActionsLabel}>');
    expect(closeActions).toContain('<ActionGroup className="form-actions" label={markLostActionsLabel}>');
    expect(closeActions).toContain("aria-label={markWonActionLabel}");
    expect(closeActions).toContain("title={markWonActionLabel}");
    expect(closeActions).toContain("aria-label={markLostActionLabel}");
    expect(closeActions).toContain("title={markLostActionLabel}");
    expect(closeActions).toContain("button-danger button-compact");
  });

  it("stores lost reason in audit metadata instead of the Deal model", () => {
    expect(schema).not.toContain("lostReason");
    expect(service).toContain("lostReason");
    expect(closeActions).toContain("Lost reason");
    expect(closeActions).toContain("lostReason: statusToSet === \"LOST\"");
  });

  it("writes close-specific audit events", () => {
    expect(service).toContain("deal.won");
    expect(service).toContain("deal.lost");
    expect(service).toContain("deal.reopened");
    expect(service).toContain("previousStatus");
    expect(service).toContain("nextStatus");
  });

  it("locks unsafe edits and stage movement after close", () => {
    expect(service).toContain("DEAL_CLOSED");
    expect(service).toContain("USE_DEAL_CLOSE_FLOW");
    expect(service).toContain("export async function softDeleteDeal");
    expect(detailPage).toContain('closedDealLockMessage("stage")');
    expect(detailPage).toContain("locked={deal.status !== \"OPEN\"}");
    expect(recordHeaderActions).toContain("lockedLabel = \"Editing locked\"");
    expect(recordHeaderActions).not.toContain("aria-label={`Edit unavailable: ${lockedLabel}`}");
    expect(recordHeaderActions).toContain("const editLockedActionLabel = lockedRecordActionLabel(editLabel, lockedLabel, recordTitle)");
    expect(recordHeaderActions).toContain("aria-label={editLockedActionLabel}");
    expect(recordHeaderActions).toContain("title={editLockedActionLabel}");
    expect(editPage).toContain("Closed deals are locked");
    expect(dealForm).not.toContain("<span>Status</span>");
  });

  it("keeps closed deals visible but distinct on the pipeline board", () => {
    expect(pipelineBoard).toContain("deal-card-closed");
    expect(pipelineBoard).toContain("isClosed ? \"Closed\"");
    expect(pipelineMoveControl).toContain("Open the deal and use Mark won or Mark lost to close it intentionally.");
    expect(pipelineMoveControl).toContain("selectedStageRequiresCloseOutcome");
  });
});
