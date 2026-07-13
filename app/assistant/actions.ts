"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import type { AssistantDraftAction } from "@/lib/services/assistant/assistant-draft-action-service";
import {
  applyAssistantActionRequest,
  createAssistantActionRequest,
  hideAssistantTodayCommandCenterItem,
  rejectAssistantActionRequest,
  sendAssistantConversationMessage
} from "@/lib/services/crm";

export async function sendAssistantConversationMessageAction(formData: FormData) {
  const message = stringValue(formData.get("message"), 2_000);
  const conversationId = stringValue(formData.get("conversationId"), 160);
  const { actor } = await getCurrentWorkspaceContext();

  let conversation;
  try {
    conversation = await sendAssistantConversationMessage(actor, { conversationId, message });
  } catch {
    redirect(assistantChatRedirect("error", conversationId));
  }

  revalidatePath("/assistant");
  redirect(assistantChatRedirect("sent", conversation.id));
}

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

export async function hideAssistantTodayCommandCenterItemAction(formData: FormData) {
  const itemKey = stringValue(formData.get("itemKey"));
  const { actor } = await getCurrentWorkspaceContext();

  try {
    await hideAssistantTodayCommandCenterItem(actor, { itemKey });
  } catch {
    redirect(todayCommandCenterRedirect("hide-error"));
  }

  revalidatePath("/assistant");
  redirect(todayCommandCenterRedirect("hidden"));
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

function stringValue(value: FormDataEntryValue | null, maxLength = 640) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function assistantChatRedirect(status: string, conversationId = "") {
  const params = new URLSearchParams({ assistantChat: status });
  if (conversationId) params.set("conversation", conversationId);
  return `/assistant?${params.toString()}#assistant-chat-composer` as Route;
}

function assistantRedirect(status: string, command = "", queue?: string) {
  const params = new URLSearchParams({ actionRequest: status });
  if (command) params.set("command", command);
  if (queue) params.set("queue", queue);
  return `/assistant?${params.toString()}#assistant-review-queue` as Route;
}

function todayCommandCenterRedirect(status: string) {
  const params = new URLSearchParams({ todayCommandCenter: status });
  return `/assistant?${params.toString()}#assistant-today-command-center-title` as Route;
}
