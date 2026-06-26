import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const settingsActions = readFileSync(join(process.cwd(), "app/settings/actions.ts"), "utf8");

describe("pipeline and stage customization settings", () => {
  it("renders a compact admin settings panel for pipeline and stage edits", () => {
    expect(settingsPage).toContain("PipelineSettingsPanel");
    expect(settingsPage).toContain("Pipeline / Stage Settings");
    expect(settingsPage).toContain("updatePipelineSettingsAction");
    expect(settingsPage).toContain("updatePipelineStageSettingsAction");
    expect(settingsPage).toContain("createPipelineStageSettingsAction");
    expect(settingsPage).toContain("Save pipeline");
    expect(settingsPage).toContain("Save stage");
    expect(settingsPage).toContain("Add stage");
    expect(settingsPage).toContain("Stage removal deferred");
    expect(settingsPage).toContain("safe move path for active deals");
  });

  it("uses existing workspace-scoped pipeline services without adding broad stage deletion", () => {
    expect(settingsActions).toContain("updatePipeline(actor, pipelineId, { name })");
    expect(settingsActions).toContain("updateStage(actor, stageId, { name, probability })");
    expect(settingsActions).toContain("createStage(actor, pipelineId, { name, probability, sortOrder })");
    expect(settingsActions).toContain("listStages(actor, pipelineId)");
    expect(settingsActions).toContain("normalizeProbability");
    expect(settingsActions).not.toContain("softDeleteStage");
  });
});
