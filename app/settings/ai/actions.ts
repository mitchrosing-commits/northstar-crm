"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { aiActionPermissionKeys, resetAiPreferences, updateAiPreferences } from "@/lib/services/crm";

export async function updateAiPreferencesAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const returnSection = stringValue(formData.get("returnSection"));
  const permissionGroup = stringValue(formData.get("activePermissionGroup"));
  await updateAiPreferences(actor, {
    assistantActionPermissions: Object.fromEntries(
      aiActionPermissionKeys.map((key) => [key, stringValue(formData.get(`assistantActionPermission:${key}`))])
    ),
    assistantDetailLevel: stringValue(formData.get("assistantDetailLevel")),
    assistantNamePreset: stringValue(formData.get("assistantNamePreset")),
    assistantCustomName: stringValue(formData.get("assistantCustomName")),
    assistantHelpAreas: formData.getAll("assistantHelpAreas").map(stringValue),
    assistantTonePreset: stringValue(formData.get("assistantTonePreset")),
    diagnosticsDetailLevel: stringValue(formData.get("diagnosticsDetailLevel")),
    emailSummaryLength: stringValue(formData.get("emailSummaryLength")),
    meetingIntelligenceNoteStyle: stringValue(formData.get("meetingIntelligenceNoteStyle")),
    naturalLanguageInstructions: stringValue(formData.get("naturalLanguageInstructions")),
    onboardingGoals: stringValue(formData.get("onboardingGoals")),
    recordSummaryStyle: stringValue(formData.get("recordSummaryStyle")),
    relationshipMemoryUsage: stringValue(formData.get("relationshipMemoryUsage")),
    replyTone: stringValue(formData.get("replyTone")),
    suggestionAggressiveness: stringValue(formData.get("suggestionAggressiveness"))
  });
  revalidatePath("/settings/ai");
  revalidatePath("/email");
  revalidatePath("/contacts");
  revalidatePath("/deals");
  revalidatePath("/leads");
  revalidatePath("/organizations");
  redirect(settingsAiRedirect("saved", permissionGroup ? "permissions" : returnSection, permissionGroup));
}

export async function resetAiPreferencesAction() {
  const { actor } = await getCurrentWorkspaceContext();
  await resetAiPreferences(actor);
  revalidatePath("/settings/ai");
  redirect("/settings/ai?reset=1&section=permissions#ai-permissions");
}

function stringValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function settingsAiRedirect(status: "saved", returnSection: string, permissionGroup: string) {
  const params = new URLSearchParams({ [status]: "1" });
  if (returnSection === "permissions") {
    params.set("section", "permissions");
    if (permissionGroup) params.set("group", permissionGroup);
    return `/settings/ai?${params.toString()}#ai-permissions` as Route;
  }
  return `/settings/ai?${params.toString()}#ai-preferences` as Route;
}
