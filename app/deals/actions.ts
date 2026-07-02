"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { dealListStateOptions } from "@/lib/deal-list-state";
import { parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { ignoreMissingSavedView } from "@/lib/saved-view-action-utils";
import { createAutomationTemplateActivity, createDealSavedView, deleteDealSavedView, type AutomationTemplateId } from "@/lib/services/crm";

export async function createDealSavedViewAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const state = parseListViewState(formDataToSearchParams(formData), dealListStateOptions);

  await createDealSavedView(actor, {
    name: String(formData.get("name") ?? ""),
    state
  });
  revalidatePath("/deals");
}

export async function deleteDealSavedViewAction(formData: FormData) {
  const savedViewId = String(formData.get("savedViewId") ?? "");
  const { actor } = await getCurrentWorkspaceContext();

  await ignoreMissingSavedView(() => deleteDealSavedView(actor, savedViewId));
  revalidatePath("/deals");
}

export async function createDealAutomationActivityAction(formData: FormData) {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim() as AutomationTemplateId;
  const { actor } = await getCurrentWorkspaceContext();

  await createAutomationTemplateActivity(actor, { templateId, dealId });
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/dashboard");
  redirect(`/deals/${dealId}?automation=activity-created#add-activity`);
}

function formDataToSearchParams(formData: FormData): ListSearchParams {
  const params: ListSearchParams = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
