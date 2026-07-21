import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applySupplyChainVerticalPresets: vi.fn(),
  createStage: vi.fn(),
  getCurrentWorkspaceContext: vi.fn(),
  listStages: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  enqueueGmailInboxSyncJob: vi.fn(),
  enqueueGmailInboxSyncJobForSelectedConnection: vi.fn(),
  syncRecentMicrosoftMessages: vi.fn(),
  updatePipeline: vi.fn(),
  updateStage: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/auth/request-context", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext
}));

vi.mock("@/lib/services/crm", () => ({
  applySupplyChainVerticalPresets: mocks.applySupplyChainVerticalPresets,
  createStage: mocks.createStage,
  enqueueGmailInboxSyncJob: mocks.enqueueGmailInboxSyncJob,
  enqueueGmailInboxSyncJobForSelectedConnection: mocks.enqueueGmailInboxSyncJobForSelectedConnection,
  listStages: mocks.listStages,
  syncRecentMicrosoftMessages: mocks.syncRecentMicrosoftMessages,
  updatePipeline: mocks.updatePipeline,
  updateStage: mocks.updateStage
}));

import {
  applySupplyChainVerticalSetupAction,
  createPipelineStageSettingsAction,
  syncRecentGmailAction,
  syncRecentMicrosoftAction,
  updatePipelineSettingsAction,
  updatePipelineStageSettingsAction
} from "@/app/settings/actions";

const actor = { workspaceId: "workspace_1", actorUserId: "user_1" };

function redirectError(url: string) {
  return Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT", url });
}

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

describe("settings server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
  });

  it("syncs provider mail from Settings with provider-specific success and error redirects", async () => {
    mocks.enqueueGmailInboxSyncJob.mockResolvedValue({ status: "queued" });
    mocks.syncRecentMicrosoftMessages.mockResolvedValue({ created: 2 });

    await expect(syncRecentGmailAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?emailConnection=gmail-sync-queued#email-connections"
    });
    expect(mocks.enqueueGmailInboxSyncJob).toHaveBeenCalledWith(actor);

    await expect(syncRecentGmailAction(form({ connectionId: "connection_1" }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?emailConnection=gmail-sync-queued#email-connections"
    });
    expect(mocks.enqueueGmailInboxSyncJobForSelectedConnection).toHaveBeenCalledWith(
      actor,
      "connection_1",
    );

    await expect(syncRecentMicrosoftAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?emailConnection=microsoft-synced&created=2"
    });
    expect(mocks.syncRecentMicrosoftMessages).toHaveBeenCalledWith({ actor, maxResults: 10 });

    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
    mocks.enqueueGmailInboxSyncJob.mockRejectedValue(new Error("provider token=raw-token"));
    mocks.syncRecentMicrosoftMessages.mockRejectedValue(new Error("provider token=raw-token"));

    await expect(syncRecentGmailAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?emailConnection=gmail-sync-error"
    });
    await expect(syncRecentMicrosoftAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?emailConnection=microsoft-sync-error"
    });
  });

  it("updates pipeline names after trimming form input and revalidates Settings plus Pipeline", async () => {
    await expect(
      updatePipelineSettingsAction(
        form({ name: "  Enterprise    Sales  ", pipelineId: "pipeline_1" })
      )
    ).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?pipelineSettings=saved#pipeline-settings"
    });

    expect(mocks.updatePipeline).toHaveBeenCalledWith(actor, "pipeline_1", {
      name: "Enterprise Sales"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pipeline");
  });

  it("redirects incomplete pipeline settings submissions before writing", async () => {
    await expect(
      updatePipelineSettingsAction(form({ name: " ", pipelineId: "pipeline_1" }))
    ).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?pipelineSettings=missing"
    });

    expect(mocks.updatePipeline).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("normalizes stage probabilities for stage update and create actions", async () => {
    await expect(
      updatePipelineStageSettingsAction(
        form({ name: "  Proposal   Review  ", probability: "150", stageId: "stage_1" })
      )
    ).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?pipelineSettings=saved#pipeline-settings"
    });

    expect(mocks.updateStage).toHaveBeenCalledWith(actor, "stage_1", {
      name: "Proposal Review",
      probability: 100
    });

    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
    mocks.listStages.mockResolvedValue([{ sortOrder: 5 }, { sortOrder: 9 }]);

    await expect(
      createPipelineStageSettingsAction(
        form({ name: "  Legal   Review  ", pipelineId: "pipeline_1", probability: "not-a-number" })
      )
    ).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?pipelineSettings=saved#pipeline-settings"
    });

    expect(mocks.listStages).toHaveBeenCalledWith(actor, "pipeline_1");
    expect(mocks.createStage).toHaveBeenCalledWith(actor, "pipeline_1", {
      name: "Legal Review",
      probability: null,
      sortOrder: 10
    });
  });

  it("applies supply-chain presets with the expected Settings and CRM route revalidation", async () => {
    await expect(applySupplyChainVerticalSetupAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?supplyChainSetup=applied#supply-chain-vertical-title"
    });

    expect(mocks.applySupplyChainVerticalPresets).toHaveBeenCalledWith(actor);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/settings",
      "/custom-fields",
      "/deals",
      "/leads",
      "/organizations",
      "/products"
    ]);
  });

  it("keeps failed supply-chain preset attempts on Settings without stale revalidation", async () => {
    mocks.applySupplyChainVerticalPresets.mockRejectedValue(new Error("preset failure"));

    await expect(applySupplyChainVerticalSetupAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings?supplyChainSetup=error#supply-chain-vertical-title"
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
