"use server";

import { revalidatePath } from "next/cache";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { dealListStateOptions } from "@/lib/deal-list-state";
import { parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { createDealSavedView, deleteDealSavedView } from "@/lib/services/crm";

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

  await deleteDealSavedView(actor, savedViewId);
  revalidatePath("/deals");
}

function formDataToSearchParams(formData: FormData): ListSearchParams {
  const params: ListSearchParams = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
