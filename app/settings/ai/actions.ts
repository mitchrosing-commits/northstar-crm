"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { resetAiPreferences, updateAiPreferences } from "@/lib/services/crm";

export async function updateAiPreferencesAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  await updateAiPreferences(actor, {
    assistantDetailLevel: stringValue(formData.get("assistantDetailLevel")),
    diagnosticsDetailLevel: stringValue(formData.get("diagnosticsDetailLevel")),
    emailSummaryLength: stringValue(formData.get("emailSummaryLength")),
    meetingIntelligenceNoteStyle: stringValue(formData.get("meetingIntelligenceNoteStyle")),
    naturalLanguageInstructions: stringValue(formData.get("naturalLanguageInstructions")),
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
  redirect("/settings/ai?saved=1");
}

export async function resetAiPreferencesAction() {
  const { actor } = await getCurrentWorkspaceContext();
  await resetAiPreferences(actor);
  revalidatePath("/settings/ai");
  redirect("/settings/ai?reset=1");
}

function stringValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}
