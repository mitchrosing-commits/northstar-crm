"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { leadListStateOptions } from "@/lib/lead-list-state";
import { parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { ignoreMissingSavedView } from "@/lib/saved-view-action-utils";
import { createAutomationTemplateActivity } from "@/lib/services/automation-template-service";
import { createLeadSavedView, deleteLeadSavedView } from "@/lib/services/saved-view-service";

export async function createLeadSavedViewAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const state = parseListViewState(formDataToSearchParams(formData), leadListStateOptions);

  await createLeadSavedView(actor, {
    name: String(formData.get("name") ?? ""),
    state
  });
  revalidatePath("/leads");
}

export async function deleteLeadSavedViewAction(formData: FormData) {
  const savedViewId = String(formData.get("savedViewId") ?? "");
  const { actor } = await getCurrentWorkspaceContext();

  await ignoreMissingSavedView(() => deleteLeadSavedView(actor, savedViewId));
  revalidatePath("/leads");
}

export async function createLeadAutomationActivityAction(formData: FormData) {
  const leadId = String(formData.get("leadId") ?? "").trim();
  const { actor } = await getCurrentWorkspaceContext();

  await createAutomationTemplateActivity(actor, { templateId: "lead-first-outreach", leadId });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/dashboard");
  redirect(`/leads/${leadId}?automation=activity-created#activities`);
}

function formDataToSearchParams(formData: FormData): ListSearchParams {
  const params: ListSearchParams = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
