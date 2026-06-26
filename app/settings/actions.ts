"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { createStage, listStages, syncRecentGmailMessages, syncRecentMicrosoftMessages, updatePipeline, updateStage } from "@/lib/services/crm";

export async function syncRecentGmailAction() {
  const { actor } = await getCurrentWorkspaceContext();
  let created = 0;

  try {
    const result = await syncRecentGmailMessages({ actor, maxResults: 10 });
    created = result.created;
  } catch {
    redirect("/settings?emailConnection=gmail-sync-error");
  }

  redirect(`/settings?emailConnection=gmail-synced&created=${created}`);
}

export async function syncRecentMicrosoftAction() {
  const { actor } = await getCurrentWorkspaceContext();
  let created = 0;

  try {
    const result = await syncRecentMicrosoftMessages({ actor, maxResults: 10 });
    created = result.created;
  } catch {
    redirect("/settings?emailConnection=microsoft-sync-error");
  }

  redirect(`/settings?emailConnection=microsoft-synced&created=${created}`);
}

export async function updatePipelineSettingsAction(formData: FormData) {
  const pipelineId = String(formData.get("pipelineId") ?? "").trim();
  const name = normalizeName(formData.get("name"));
  const { actor } = await getCurrentWorkspaceContext();

  if (!pipelineId || !name) redirect("/settings?pipelineSettings=missing");

  await updatePipeline(actor, pipelineId, { name });
  revalidatePath("/settings");
  revalidatePath("/pipeline");
  redirect("/settings?pipelineSettings=saved#pipeline-settings");
}

export async function updatePipelineStageSettingsAction(formData: FormData) {
  const stageId = String(formData.get("stageId") ?? "").trim();
  const name = normalizeName(formData.get("name"));
  const probability = normalizeProbability(formData.get("probability"));
  const { actor } = await getCurrentWorkspaceContext();

  if (!stageId || !name) redirect("/settings?pipelineSettings=missing");

  await updateStage(actor, stageId, { name, probability });
  revalidatePath("/settings");
  revalidatePath("/pipeline");
  redirect("/settings?pipelineSettings=saved#pipeline-settings");
}

export async function createPipelineStageSettingsAction(formData: FormData) {
  const pipelineId = String(formData.get("pipelineId") ?? "").trim();
  const name = normalizeName(formData.get("name"));
  const probability = normalizeProbability(formData.get("probability"));
  const { actor } = await getCurrentWorkspaceContext();

  if (!pipelineId || !name) redirect("/settings?pipelineSettings=missing");

  const stages = await listStages(actor, pipelineId);
  const sortOrder = stages.reduce((max, stage) => Math.max(max, stage.sortOrder), 0) + 1;
  await createStage(actor, pipelineId, { name, probability, sortOrder });
  revalidatePath("/settings");
  revalidatePath("/pipeline");
  redirect("/settings?pipelineSettings=saved#pipeline-settings");
}

function normalizeName(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeProbability(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}
