import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pipelinePage = readFileSync(join(process.cwd(), "app/pipeline/page.tsx"), "utf8");
const pipelineBoard = readFileSync(join(process.cwd(), "components/pipeline-board.tsx"), "utf8");
const moveControl = readFileSync(join(process.cwd(), "components/pipeline-stage-move-control.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("pipeline board demo interactivity", () => {
  it("renders each deal card with a full-card semantic deal link", () => {
    expect(pipelineBoard).toContain("className=\"deal-card-link\"");
    expect(pipelineBoard).toContain("href={`/deals/${deal.id}`}");
    expect(pipelineBoard).toContain("aria-label={`Open deal ${deal.title}`}");
    expect(pipelineBoard).toContain("Open deal");
  });

  it("adds visible board guidance and card hover/focus affordances", () => {
    expect(pipelinePage).toContain("Open a deal to update stage, activities, notes, and quotes, or use Move on a card.");
    expect(styles).toContain(".deal-card:hover,");
    expect(styles).toContain(".deal-card:focus-within");
    expect(styles).toContain(".deal-card-link:hover .deal-card-title");
    expect(styles).toContain(".deal-card-open");
  });

  it("surfaces existing contract status fields on pipeline deal cards without seeding fake data", () => {
    expect(pipelinePage).toContain("listCustomFieldSummaries(actor, \"DEAL\", dealIds)");
    expect(pipelinePage).toContain("contractFields: customFieldSummaries.get(deal.id) ?? []");
    expect(pipelineBoard).toContain("ContractWorkflowSummary");
    expect(pipelineBoard).toContain("fields={deal.contractFields ?? []}");
    expect(styles).toContain(".contract-status-mini");
    expect(styles).toContain(".contract-status-summary");
  });

  it("provides a compact board-level stage move fallback through the existing deal API", () => {
    expect(pipelineBoard).toContain("PipelineStageMoveControl");
    expect(moveControl).toContain("\"use client\"");
    expect(moveControl).toContain("PATCH");
    expect(moveControl).toContain("/api/v1/workspaces/${workspaceId}/deals/${dealId}");
    expect(moveControl).toContain("JSON.stringify({ pipelineId, stageId: selectedStage.id })");
    expect(moveControl).toContain("router.refresh()");
    expect(moveControl).toContain("disabled={!canMove || unchanged || isSaving}");
  });
});
