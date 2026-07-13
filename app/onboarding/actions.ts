"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { updateAiPreferences } from "@/lib/services/crm";

export async function updateOnboardingAiPreferencesAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  await updateAiPreferences(actor, {
    assistantNamePreset: stringValue(formData.get("assistantNamePreset")),
    assistantCustomName: stringValue(formData.get("assistantCustomName")),
    assistantTonePreset: stringValue(formData.get("assistantTonePreset")),
    assistantHelpAreas: formData.getAll("assistantHelpAreas").map(stringValue),
    onboardingGoals: stringValue(formData.get("onboardingGoals"))
  });
  revalidatePath("/onboarding");
  revalidatePath("/settings/ai");
  redirect("/onboarding?saved=1");
}

function stringValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}
