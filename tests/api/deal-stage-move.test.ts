import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const detailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const moveForm = readFileSync(join(process.cwd(), "components/deal-stage-move-form.tsx"), "utf8");
const service = [
  readFileSync(join(process.cwd(), "lib/services/deal-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");

describe("deal stage movement UI", () => {
  it("renders a stage movement form on the deal detail page", () => {
    expect(detailPage).toContain("DealStageMoveForm");
    expect(detailPage).toContain("listStages(actor, deal.pipelineId)");
    expect(detailPage).toContain("LockedPanelNotice");
    expect(detailPage).toContain("title=\"Stage locked\"");
    expect(detailPage).not.toContain("<p className=\"empty-copy\">Stage movement is locked after a deal is closed.</p>");
  });

  it("submits stage changes through the existing workspace deal update API", () => {
    expect(moveForm).toContain("PATCH");
    expect(moveForm).toContain("/api/v1/workspaces/${workspaceId}/deals/${dealId}");
    expect(moveForm).toContain("pipelineId");
    expect(moveForm).toContain("stageId");
    expect(moveForm).toContain("FormActionBar");
    expect(moveForm).toContain("import { FormFieldLabel }");
    expect(moveForm).toContain("<FormFieldLabel required>Move to stage</FormFieldLabel>");
    expect(moveForm).toContain("submitDisabled={stageId === currentStageId}");
  });

  it("validates target stages against the existing deal pipeline", () => {
    expect(service).toContain("nextPipelineId !== existing.pipelineId");
    expect(service).toContain("assertDealPipelineAndStage");
  });

  it("uses the shared empty-state pattern when a pipeline has no stages", () => {
    expect(moveForm).toContain("EmptyState");
    expect(moveForm).toContain("title=\"No stages available\"");
    expect(moveForm).toContain("deal-stage-empty");
    expect(moveForm).not.toContain("return <p className=\"empty-copy\">No stages are available in this pipeline.</p>;");
  });
});
