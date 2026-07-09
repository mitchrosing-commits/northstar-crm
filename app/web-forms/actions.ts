"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { createWebForm, updateWebForm } from "@/lib/services/crm";

export async function createWebFormAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  await createWebForm(actor, {
    name: String(formData.get("name") ?? ""),
    publicTitle: String(formData.get("publicTitle") ?? ""),
    publicDescription: String(formData.get("publicDescription") ?? ""),
    sourceLabel: String(formData.get("sourceLabel") ?? ""),
    requireLeadTitle: formData.get("requireLeadTitle") === "on"
  });

  revalidatePath("/web-forms");
  redirect("/web-forms?created=1" as Route);
}

export async function setWebFormEnabledAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const webFormId = String(formData.get("webFormId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";

  await updateWebForm(actor, webFormId, { isEnabled: enabled });
  revalidatePath("/web-forms");
  redirect(`/web-forms?${enabled ? "enabled" : "disabled"}=1` as Route);
}
