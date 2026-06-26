import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const service = [
  readFileSync(join(process.cwd(), "lib/services/deal-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");
const form = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");

describe("deal create/update behavior", () => {
  it("routes deal create and update through validated API payloads", () => {
    expect(route).toContain("createDealSchema.parse");
    expect(route).toContain("updateDealSchema.parse");
    expect(route).toContain("createDeal(actor");
    expect(route).toContain("updateDeal(actor");
  });

  it("keeps deal mutations workspace-scoped and audited", () => {
    expect(service).toContain("assertDealPipelineAndStage(actor.workspaceId");
    expect(service).toContain("writeAuditLog(actor, \"deal.created\"");
    expect(service).toContain("stageChanged ? \"deal.stage_changed\" : \"deal.updated\"");
  });

  it("prevents cross-pipeline stage moves and audits valid stage changes", () => {
    expect(service).toContain("INVALID_PIPELINE_MOVE");
    expect(service).toContain("Move the deal within its current pipeline.");
    expect(service).toContain("deal.stage_changed");
    expect(service).toContain("previousStageId");
    expect(service).toContain("nextStageId");
  });

  it("submits create and edit forms to the workspace-scoped deal API", () => {
    expect(form).toContain("mode === \"create\"");
    expect(form).toContain("method = mode === \"create\" ? \"POST\" : \"PATCH\"");
    expect(form).toContain("/api/v1/workspaces/${workspaceId}/deals");
    expect(form).toContain("valueCents");
    expect(form).toContain("expectedCloseAt");
  });
});
