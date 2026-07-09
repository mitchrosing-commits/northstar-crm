"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import type { AssistantDraftAction } from "@/lib/services/assistant/assistant-draft-action-service";
import { applyAssistantActionRequest, createAssistantActionRequest, rejectAssistantActionRequest } from "@/lib/services/crm";

export async function saveAssistantDraftActionRequest(formData: FormData) {
  const draftAction = parseDraftAction(formData.get("draftAction"));
  const sourceCommand = stringValue(formData.get("sourceCommand"));
  const returnCommand = stringValue(formData.get("returnCommand"));
  const { actor } = await getCurrentWorkspaceContext();

  try {
    await createAssistantActionRequest(actor, { draftAction, sourceCommand });
  } catch {
    redirect(assistantRedirect("error", returnCommand));
  }

  revalidatePath("/assistant");
  redirect(assistantRedirect("saved", returnCommand, "pending"));
}

export async function rejectAssistantActionRequestAction(formData: FormData) {
  const requestId = stringValue(formData.get("requestId"));
  const { actor } = await getCurrentWorkspaceContext();

  try {
    await rejectAssistantActionRequest(actor, requestId);
  } catch {
    redirect(assistantRedirect("reject-error"));
  }

  revalidatePath("/assistant");
  redirect(assistantRedirect("rejected", "", "rejected"));
}

export async function applyAssistantActionRequestAction(formData: FormData) {
  const requestId = stringValue(formData.get("requestId"));
  const { actor } = await getCurrentWorkspaceContext();

  try {
    await applyAssistantActionRequest(actor, requestId);
  } catch {
    redirect(assistantRedirect("apply-error"));
  }

  revalidatePath("/assistant");
  redirect(assistantRedirect("applied", "", "applied"));
}

function parseDraftAction(value: FormDataEntryValue | null): AssistantDraftAction {
  if (typeof value !== "string" || value.length > 20_000) throw new Error("Invalid draft action.");
  const parsed = JSON.parse(value) as Partial<AssistantDraftAction>;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid draft action.");
  if (typeof parsed.id !== "string" || typeof parsed.kind !== "string" || typeof parsed.title !== "string") {
    throw new Error("Invalid draft action.");
  }
  if (!Array.isArray(parsed.fields) || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.warnings) || !Array.isArray(parsed.missingInfo)) {
    throw new Error("Invalid draft action.");
  }
  return parsed as AssistantDraftAction;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().slice(0, 640) : "";
}

function assistantRedirect(status: string, command = "", queue?: string) {
  const params = new URLSearchParams({ actionRequest: status });
  if (command) params.set("command", command);
  if (queue) params.set("queue", queue);
  return `/assistant?${params.toString()}#assistant-review-queue` as Route;
}
