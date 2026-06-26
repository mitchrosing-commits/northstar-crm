"use server";

import { revalidatePath } from "next/cache";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { organizationListStateOptions } from "@/lib/organization-list-state";
import { createOrganizationSavedView, deleteOrganizationSavedView } from "@/lib/services/crm";

export async function createOrganizationSavedViewAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const state = parseListViewState(formDataToSearchParams(formData), organizationListStateOptions);

  await createOrganizationSavedView(actor, {
    name: String(formData.get("name") ?? ""),
    state
  });
  revalidatePath("/organizations");
}

export async function deleteOrganizationSavedViewAction(formData: FormData) {
  const savedViewId = String(formData.get("savedViewId") ?? "");
  const { actor } = await getCurrentWorkspaceContext();

  await deleteOrganizationSavedView(actor, savedViewId);
  revalidatePath("/organizations");
}

function formDataToSearchParams(formData: FormData): ListSearchParams {
  const params: ListSearchParams = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
