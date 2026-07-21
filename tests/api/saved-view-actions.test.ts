import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/responses";

const mocks = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  createAutomationTemplateActivity: vi.fn(),
  createDealSavedView: vi.fn(),
  deleteDealSavedView: vi.fn(),
  createLeadSavedView: vi.fn(),
  deleteLeadSavedView: vi.fn(),
  createContactSavedView: vi.fn(),
  deleteContactSavedView: vi.fn(),
  createOrganizationSavedView: vi.fn(),
  deleteOrganizationSavedView: vi.fn()
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
  createContactSavedView: mocks.createContactSavedView,
  deleteContactSavedView: mocks.deleteContactSavedView,
  createOrganizationSavedView: mocks.createOrganizationSavedView,
  deleteOrganizationSavedView: mocks.deleteOrganizationSavedView
}));

vi.mock("@/lib/services/saved-view-service", () => ({
  createDealSavedView: mocks.createDealSavedView,
  deleteDealSavedView: mocks.deleteDealSavedView,
  createLeadSavedView: mocks.createLeadSavedView,
  deleteLeadSavedView: mocks.deleteLeadSavedView
}));

vi.mock("@/lib/services/automation-template-service", () => ({
  createAutomationTemplateActivity: mocks.createAutomationTemplateActivity
}));

import { createContactSavedViewAction, deleteContactSavedViewAction } from "@/app/contacts/actions";
import { createDealSavedViewAction, deleteDealSavedViewAction } from "@/app/deals/actions";
import { createLeadSavedViewAction, deleteLeadSavedViewAction } from "@/app/leads/actions";
import { createOrganizationSavedViewAction, deleteOrganizationSavedViewAction } from "@/app/organizations/actions";

const actor = { workspaceId: "workspace_1", actorUserId: "user_1" };

function deleteSavedViewForm(savedViewId: string) {
  const data = new FormData();
  data.set("savedViewId", savedViewId);
  return data;
}

function createSavedViewForm(input: {
  filterKey: string;
  filterValue: string;
  savedViewName?: string;
  sortBy: string;
}) {
  const data = new FormData();
  data.set("name", input.savedViewName ?? " Pipeline follow-up ");
  data.set("q", " Needle ");
  data.set(input.filterKey, input.filterValue);
  data.set("sortBy", input.sortBy);
  data.set("sortDirection", "asc");
  data.set("page", "7");
  data.set("pageSize", "25");
  data.set("csrfToken", "raw-form-token");
  return data;
}

const savedViewCreateActions = [
  {
    name: "deals",
    action: createDealSavedViewAction,
    createSavedView: mocks.createDealSavedView,
    filterKey: "status",
    filterValue: "OPEN",
    revalidatePath: "/deals",
    sortBy: "title"
  },
  {
    name: "leads",
    action: createLeadSavedViewAction,
    createSavedView: mocks.createLeadSavedView,
    filterKey: "status",
    filterValue: "QUALIFIED",
    revalidatePath: "/leads",
    sortBy: "title"
  },
  {
    name: "contacts",
    action: createContactSavedViewAction,
    createSavedView: mocks.createContactSavedView,
    filterKey: "organizationId",
    filterValue: "org_1",
    revalidatePath: "/contacts",
    sortBy: "name"
  },
  {
    name: "organizations",
    action: createOrganizationSavedViewAction,
    createSavedView: mocks.createOrganizationSavedView,
    filterKey: "ownerId",
    filterValue: "user_2",
    revalidatePath: "/organizations",
    sortBy: "name"
  }
];

const savedViewDeleteActions = [
  {
    name: "deals",
    action: deleteDealSavedViewAction,
    deleteSavedView: mocks.deleteDealSavedView,
    revalidatePath: "/deals"
  },
  {
    name: "leads",
    action: deleteLeadSavedViewAction,
    deleteSavedView: mocks.deleteLeadSavedView,
    revalidatePath: "/leads"
  },
  {
    name: "contacts",
    action: deleteContactSavedViewAction,
    deleteSavedView: mocks.deleteContactSavedView,
    revalidatePath: "/contacts"
  },
  {
    name: "organizations",
    action: deleteOrganizationSavedViewAction,
    deleteSavedView: mocks.deleteOrganizationSavedView,
    revalidatePath: "/organizations"
  }
];

describe("saved-view server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
  });

  it.each(savedViewCreateActions)("creates $name saved views from parsed list state", async (scenario) => {
    await expect(scenario.action(createSavedViewForm(scenario))).resolves.toBeUndefined();

    expect(scenario.createSavedView).toHaveBeenCalledWith(actor, {
      name: " Pipeline follow-up ",
      state: expect.objectContaining({
        filters: expect.objectContaining({
          [scenario.filterKey]: scenario.filterValue
        }),
        pagination: { page: 7, pageSize: 25 },
        q: "Needle",
        sortBy: scenario.sortBy,
        sortDirection: "asc"
      })
    });
    expect(JSON.stringify(scenario.createSavedView.mock.calls[0]?.[1])).not.toContain("raw-form-token");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(scenario.revalidatePath);
  });

  it.each(savedViewCreateActions)("does not revalidate $name after failed saved-view creation", async (scenario) => {
    const error = new ApiError("VALIDATION_ERROR", "Saved view name is required.", 422);
    scenario.createSavedView.mockRejectedValueOnce(error);

    await expect(scenario.action(createSavedViewForm({ ...scenario, savedViewName: "   " }))).rejects.toBe(error);

    expect(scenario.createSavedView).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        name: "   "
      })
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(savedViewDeleteActions)("treats already-deleted $name saved views as deleted", async (scenario) => {
    scenario.deleteSavedView.mockRejectedValueOnce(new ApiError("NOT_FOUND", "Saved view was not found.", 404));

    await expect(scenario.action(deleteSavedViewForm("view_deleted"))).resolves.toBeUndefined();

    expect(scenario.deleteSavedView).toHaveBeenCalledWith(actor, "view_deleted");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(scenario.revalidatePath);
  });

  it.each(savedViewDeleteActions)("rethrows non-missing $name saved-view delete failures", async (scenario) => {
    const error = new ApiError("FORBIDDEN", "You do not have access to this workspace.", 403);
    scenario.deleteSavedView.mockRejectedValueOnce(error);

    await expect(scenario.action(deleteSavedViewForm("view_forbidden"))).rejects.toBe(error);

    expect(scenario.deleteSavedView).toHaveBeenCalledWith(actor, "view_forbidden");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
