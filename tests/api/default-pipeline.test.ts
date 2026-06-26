import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pipelineService = readFileSync(join(process.cwd(), "lib/services/pipeline-service.ts"), "utf8");
const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const signupActions = readFileSync(join(process.cwd(), "app/signup/actions.ts"), "utf8");
const workspaceActions = readFileSync(join(process.cwd(), "app/workspaces/actions.ts"), "utf8");
const pipelinePage = readFileSync(join(process.cwd(), "app/pipeline/page.tsx"), "utf8");
const dealsPage = readFileSync(join(process.cwd(), "app/deals/page.tsx"), "utf8");
const dealForm = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");

describe("default new-workspace pipeline", () => {
  it("defines a reusable idempotent default pipeline helper with sensible stages", () => {
    expect(pipelineService).toContain("export async function ensureDefaultPipelineForWorkspace(workspaceId: string)");
    expect(pipelineService).toContain("export const defaultPipelineName = \"New Business\"");
    expect(pipelineService).toContain("{ name: \"Qualified\", probability: 20 }");
    expect(pipelineService).toContain("{ name: \"Discovery\", probability: 35 }");
    expect(pipelineService).toContain("{ name: \"Proposal\", probability: 60 }");
    expect(pipelineService).toContain("{ name: \"Negotiation\", probability: 80 }");
    expect(pipelineService).toContain("{ name: \"Closed\", probability: 100 }");
    expect(pipelineService).toContain("prisma.pipeline.findFirst");
    expect(pipelineService).toContain("existingStageNames");
    expect(pipelineService).toContain("missingStages");
    expect(pipelineService).toContain("prisma.pipelineStage.createMany");
  });

  it("applies the default pipeline to signup-created and manually-created workspaces", () => {
    expect(workspaceService).toContain("import { ensureDefaultPipelineForWorkspace } from \"./pipeline-service\"");
    expect(workspaceService).toContain("await ensureDefaultPipelineForWorkspace(workspace.id)");
    expect(signupActions).toContain("createWorkspaceFromName(result.user.id, workspaceName)");
    expect(workspaceActions).toContain("createWorkspaceFromName(actorUserId, name)");
  });

  it("keeps empty pipeline and deal states demo-friendly", () => {
    expect(pipelinePage).not.toContain("Run the seed script");
    expect(pipelinePage).toContain("New workspaces include a default sales pipeline.");
    expect(dealsPage).toContain("No pipeline stages yet");
    expect(dealsPage).toContain("Add or restore pipeline stages before creating deals.");
    expect(dealForm).not.toContain("seed a pipeline");
    expect(dealForm).toContain("Add or restore an active pipeline stage before creating deals.");
  });
});
