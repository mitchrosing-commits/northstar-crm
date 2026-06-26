"use server";

import { revalidatePath } from "next/cache";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { contactListStateOptions } from "@/lib/contact-list-state";
import { parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { createContactSavedView, deleteContactSavedView } from "@/lib/services/crm";

export async function createContactSavedViewAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const state = parseListViewState(formDataToSearchParams(formData), contactListStateOptions);

  await createContactSavedView(actor, {
    name: String(formData.get("name") ?? ""),
    state
  });
  revalidatePath("/contacts");
}

export async function deleteContactSavedViewAction(formData: FormData) {
  const savedViewId = String(formData.get("savedViewId") ?? "");
  const { actor } = await getCurrentWorkspaceContext();

  await deleteContactSavedView(actor, savedViewId);
  revalidatePath("/contacts");
}

function formDataToSearchParams(formData: FormData): ListSearchParams {
  const params: ListSearchParams = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
