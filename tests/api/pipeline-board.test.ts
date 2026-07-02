import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pipelinePage = readFileSync(join(process.cwd(), "app/pipeline/page.tsx"), "utf8");
const pipelineBoard = readFileSync(join(process.cwd(), "components/pipeline-board.tsx"), "utf8");
const moveControl = readFileSync(join(process.cwd(), "components/pipeline-stage-move-control.tsx"), "utf8");
const pageHeader = readFileSync(join(process.cwd(), "components/page-header.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("pipeline board demo interactivity", () => {
  it("renders each deal card with a full-card semantic deal link", () => {
    expect(pipelineBoard).toContain("className=\"deal-card-link\"");
    expect(pipelineBoard).toContain("href={`/deals/${deal.id}`}");
    expect(pipelineBoard).toContain("const openDealLabel = `Open deal ${deal.title}`;");
    expect(pipelineBoard).toContain("aria-label={openDealLabel}");
    expect(pipelineBoard).toContain("title={openDealLabel}");
    expect(pipelineBoard).toContain("const attentionSignalsLabel = `${deal.title} attention signals`;");
    expect(pipelineBoard).toContain("aria-label={attentionSignalsLabel}");
    expect(pipelineBoard).toContain("title={attentionSignalsLabel}");
    expect(pipelineBoard).toContain("CompactTitleRow");
    expect(pipelineBoard).toContain("actions={<StatusBadge status={deal.status} />}");
    expect(pipelineBoard).toContain("title={deal.title}");
    expect(pipelineBoard).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(pipelineBoard).toContain('formatPersonName(deal.person) ?? "Unnamed contact"');
    expect(pipelineBoard).not.toContain("function formatPersonName");
    expect(pipelineBoard).not.toContain("className=\"deal-card-header\"");
    expect(pipelineBoard).not.toContain("className=\"deal-card-title\"");
    expect(pipelineBoard).toContain("Open deal");
  });

  it("adds visible board guidance and card hover/focus affordances", () => {
    expect(pipelineBoard).toContain("const createDealLabel = \"Create the first pipeline deal\"");
    expect(pipelineBoard).toContain("aria-label={createDealLabel}");
    expect(pipelineBoard).toContain("title={createDealLabel}");
    expect(pipelinePage).toContain("Open a deal to update stage, activities, notes, and quotes, or use Move on a card.");
    expect(pipelinePage).toContain("PageHeader");
    expect(pageHeader).toContain("className=\"header-actions\"");
    expect(pipelinePage).toContain("ListPageHeaderActions");
    expect(pipelinePage).toContain("resource=\"deals\"");
    expect(styles).toContain(".deal-card:hover,");
    expect(styles).toContain(".deal-card:focus-within");
    expect(styles).toContain(".deal-card-link:hover .compact-title");
    expect(styles).toContain(".deal-card .panel-title-row");
    expect(styles).toContain(".deal-card .compact-title");
    expect(styles).not.toContain(".deal-card-header");
    expect(styles).not.toContain(".deal-card-title");
    expect(styles).toContain(".deal-card-open");
  });

  it("surfaces existing contract status fields on pipeline deal cards without seeding fake data", () => {
    expect(pipelinePage).toContain("listCustomFieldSummaries(actor, \"DEAL\", dealIds)");
    expect(pipelinePage).toContain("listDealContractStepsForDeals(actor, dealIds)");
    expect(pipelinePage).toContain("contractFields: customFieldSummaries.get(deal.id) ?? []");
    expect(pipelinePage).toContain("contractSteps: contractStepSummaries.get(deal.id) ?? []");
    expect(pipelineBoard).toContain("ContractWorkflowSummary");
    expect(pipelineBoard).toContain("fields={deal.contractFields ?? []} steps={deal.contractSteps ?? []}");
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
    expect(moveControl).toContain("const helperId = `pipeline-move-${dealId}-helper`");
    expect(moveControl).toContain("const selectLabel = `Choose a new stage for ${dealTitle}`");
    expect(moveControl).toContain("aria-describedby={helperId}");
    expect(moveControl).toContain("aria-label={moveActionLabel}");
    expect(moveControl).toContain("title={moveTitle}");
    expect(moveControl).toContain("Choose a different stage before moving this deal.");
    expect(moveControl).toContain("Closed deals cannot be moved from the pipeline board.");
  });
});
