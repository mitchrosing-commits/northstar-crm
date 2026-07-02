import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const settingsActions = readFileSync(join(process.cwd(), "app/settings/actions.ts"), "utf8");
const validators = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const productLimits = readFileSync(join(process.cwd(), "lib/product-limits.ts"), "utf8");
const pipelineService = readFileSync(join(process.cwd(), "lib/services/pipeline-service.ts"), "utf8");

describe("pipeline and stage customization settings", () => {
  it("renders a compact admin settings panel for pipeline and stage edits", () => {
    expect(settingsPage).toContain("PipelineSettingsPanel");
    expect(settingsPage).toContain("SettingsSection");
    expect(settingsPage).toContain("badge=\"Workspace admin\"");
    expect(settingsPage).toContain("id=\"pipeline-settings\"");
    expect(settingsPage).toContain("title=\"Pipeline / Stage Settings\"");
    expect(settingsPage).toContain("Pipeline / Stage Settings");
    expect(settingsPage).toContain("updatePipelineSettingsAction");
    expect(settingsPage).toContain("updatePipelineStageSettingsAction");
    expect(settingsPage).toContain("createPipelineStageSettingsAction");
    expect(settingsPage).toContain("const savePipelineLabel = pipeline ? `Save pipeline settings for ${pipeline.name}` : \"Save pipeline settings\"");
    expect(settingsPage).toContain("const saveStageLabel = `Save stage settings for ${stage.name}`");
    expect(settingsPage).toContain("const addStageLabel = pipeline ? `Add stage to ${pipeline.name}` : \"Add pipeline stage\"");
    expect(settingsPage).toContain("import { FormActionBar }");
    expect(settingsPage).toContain("submitActionLabel={savePipelineLabel}");
    expect(settingsPage).toContain("submitActionLabel={saveStageLabel}");
    expect(settingsPage).toContain("submitActionLabel={addStageLabel}");
    expect(settingsPage).toContain("actionsLabel={stageActionsLabel}");
    expect(settingsPage).toContain('submitLabel="Save pipeline"');
    expect(settingsPage).toContain('submitLabel="Save stage"');
    expect(settingsPage).toContain('submitLabel="Add stage"');
    expect(settingsPage).toContain("Stage removal deferred.");
    expect(settingsPage).toContain("safe move path for active deals");
    expect(settingsPage).toContain("EmptyState");
    expect(settingsPage).toContain("pipeline-settings-empty");
    expect(settingsPage).toContain("title=\"No pipeline is available yet\"");
    expect(settingsPage).not.toContain("<p className=\"empty-copy\">No pipeline is available yet.");
  });

  it("uses existing workspace-scoped pipeline services without adding broad stage deletion", () => {
    expect(settingsActions).toContain("updatePipeline(actor, pipelineId, { name })");
    expect(settingsActions).toContain("updateStage(actor, stageId, { name, probability })");
    expect(settingsActions).toContain("createStage(actor, pipelineId, { name, probability, sortOrder })");
    expect(settingsActions).toContain("listStages(actor, pipelineId)");
    expect(settingsActions).toContain("normalizeProbability");
    expect(settingsActions).not.toContain("softDeleteStage");
    expect(pipelineService).toContain("Pipeline update must be an object.");
    expect(pipelineService).toContain("Stage update must be an object.");
    expect(pipelineService).toContain("pipelineInputChanges(input, existing)");
    expect(pipelineService).toContain("stageInputChanges(input, existing)");
  });

  it("validates pipeline and stage sort orders against integer storage limits", () => {
    expect(productLimits).toContain("sortOrderIntColumnMax = intColumnMax");
    expect(productLimits).toContain("sortOrderIntColumnMin = intColumnMin");
    expect(validators).toContain("Sort order is too large.");
    expect(validators).toContain("Sort order is too small.");
    expect(pipelineService).toContain("normalizeSortOrderValue(input.sortOrder)");
    expect(pipelineService).toContain("return typeof value === \"number\" ? value : Number.NaN;");
    expect(pipelineService).toContain("Sort order must be a whole number.");
    expect(pipelineService).toContain("Sort order is too large.");
  });

  it("keeps stage probability validation centralized for forecasting safety", () => {
    expect(productLimits).toContain("stageProbabilityMin = 0");
    expect(productLimits).toContain("stageProbabilityMax = 100");
    expect(validators).toContain("min(stageProbabilityMin).max(stageProbabilityMax)");
    expect(pipelineService).toContain("normalizeStageProbabilityValue(input.probability)");
    expect(pipelineService).toContain("if (value === null) return null;");
    expect(pipelineService).toContain("Stage probability must be a whole number.");
    expect(pipelineService).toContain("Stage probability must be between 0 and 100.");
  });
});
