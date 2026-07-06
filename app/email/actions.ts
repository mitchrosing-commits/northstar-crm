"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { cookies } from "next/headers";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { ApiError } from "@/lib/api/responses";
import { redactSensitiveText } from "@/lib/security/redaction";
import {
  classifyEmailLog,
  createEmailFollowUpActivity,
  disconnectEmailConnection,
  enqueueGmailInboxSyncJob,
  generateEmailReplyDraft,
  refreshGmailInboxThread,
  sendGmailReplyFromEmailLog,
  syncOlderGmailInboxMessages,
  syncRecentGmailMessages,
  syncRecentMicrosoftMessages
} from "@/lib/services/crm";
import type { EmailSmartClassification } from "@/lib/services/email-classification-service";
import { emailSyncReviewCookieName, encodeEmailSyncReview } from "./sync-review";

export type ClassifyEmailLogActionState = {
  classification?: EmailSmartClassification;
  emailLogId?: string;
  error?: string;
  message?: string;
};

export type CreateEmailFollowUpActionState = {
  activityHref?: string;
  activityId?: string;
  emailLogId?: string;
  error?: string;
  message?: string;
  targetHref?: string;
  targetLabel?: string;
};

export type GenerateEmailReplyDraftActionState = {
  contextUsed?: string[];
  emailLogId?: string;
  error?: string;
  message?: string;
  replyBody?: string;
  subjectSuggestion?: string;
  suggestedNextAction?: string;
  tone?: string;
  warnings?: string[];
};

export async function syncGmailInboxFromEmailPageAction() {
  const { actor } = await getCurrentWorkspaceContext();

  try {
    await enqueueGmailInboxSyncJob(actor);
  } catch {
    redirect("/email?emailConnection=gmail-sync-error" as Route);
  }

  redirect("/email?emailConnection=gmail-sync-queued" as Route);
}

export async function loadOlderGmailInboxFromEmailPageAction(formData: FormData) {
  const before = String(formData.get("before") ?? "").trim();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const { actor } = await getCurrentWorkspaceContext();
  let result: Awaited<ReturnType<typeof syncOlderGmailInboxMessages>>;

  try {
    result = await syncOlderGmailInboxMessages({ actor, before });
  } catch {
    const params = new URLSearchParams({ emailConnection: "gmail-load-more-error" });
    if (threadId) params.set("thread", threadId);
    redirect(`/email?${params.toString()}` as Route);
  }

  const params = new URLSearchParams({
    created: String(result.created),
    duplicates: String(result.skippedDuplicates),
    emailConnection: "gmail-loaded-more",
    total: String(result.totalFetched)
  });
  if (threadId) params.set("thread", threadId);
  redirect(`/email?${params.toString()}` as Route);
}

export async function refreshGmailThreadFromEmailPageAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "").trim();
  const { actor } = await getCurrentWorkspaceContext();
  let result: Awaited<ReturnType<typeof refreshGmailInboxThread>>;

  try {
    result = await refreshGmailInboxThread({ actor, threadId });
  } catch {
    const params = new URLSearchParams({ emailConnection: "gmail-thread-refresh-error" });
    if (threadId) params.set("thread", threadId);
    redirect(`/email?${params.toString()}` as Route);
  }

  const params = new URLSearchParams({
    created: String(result.created),
    duplicates: String(result.skippedDuplicates),
    emailConnection: "gmail-thread-refreshed",
    thread: threadId,
    total: String(result.totalFetched)
  });
  redirect(`/email?${params.toString()}` as Route);
}

export async function syncRecentGmailFromEmailPageAction() {
  const { actor } = await getCurrentWorkspaceContext();
  let result: Awaited<ReturnType<typeof syncRecentGmailMessages>>;

  try {
    result = await syncRecentGmailMessages({ actor, maxResults: 10 });
  } catch {
    redirect("/email?emailConnection=gmail-sync-error" as Route);
  }

  await setEmailSyncReviewCookie({
    created: result.created,
    duplicates: result.skippedDuplicates,
    provider: "Gmail",
    skipped: result.skippedUnmatched,
    totalFetched: result.totalFetched,
    unmatchedPreviews: result.unmatchedPreviews
  });
  redirect(
    `/email?emailConnection=gmail-synced&created=${result.created}&duplicates=${result.skippedDuplicates}&skipped=${result.skippedUnmatched}&total=${result.totalFetched}` as Route
  );
}

export async function syncRecentMicrosoftFromEmailPageAction() {
  const { actor } = await getCurrentWorkspaceContext();
  let result: Awaited<ReturnType<typeof syncRecentMicrosoftMessages>>;

  try {
    result = await syncRecentMicrosoftMessages({ actor, maxResults: 10 });
  } catch {
    redirect("/email?emailConnection=microsoft-sync-error" as Route);
  }

  await setEmailSyncReviewCookie({
    created: result.created,
    duplicates: result.skippedDuplicates,
    provider: "Microsoft",
    skipped: result.skippedUnmatched,
    totalFetched: result.totalFetched,
    unmatchedPreviews: result.unmatchedPreviews
  });
  redirect(
    `/email?emailConnection=microsoft-synced&created=${result.created}&duplicates=${result.skippedDuplicates}&skipped=${result.skippedUnmatched}&total=${result.totalFetched}` as Route
  );
}

export async function sendGmailReplyFromEmailPageAction(formData: FormData) {
  const emailLogId = String(formData.get("emailLogId") ?? "").trim();
  const threadId = String(formData.get("threadId") ?? "").trim();

  try {
    const { actor } = await getCurrentWorkspaceContext();
    await sendGmailReplyFromEmailLog({
      actor,
      body: formData.get("body"),
      emailLogId
    });
  } catch {
    const params = new URLSearchParams({ emailConnection: "gmail-reply-error" });
    if (threadId) params.set("thread", threadId);
    redirect(`/email?${params.toString()}` as Route);
  }

  const params = new URLSearchParams({ emailConnection: "gmail-reply-sent" });
  if (threadId) params.set("thread", threadId);
  redirect(`/email?${params.toString()}` as Route);
}

export async function disconnectEmailProviderFromEmailPageAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "").trim();
  let status: "gmail-disconnected" | "microsoft-disconnected";

  try {
    const { actor } = await getCurrentWorkspaceContext();
    const result = await disconnectEmailConnection(actor, provider);
    status = result.provider === "MICROSOFT_365" ? "microsoft-disconnected" : "gmail-disconnected";
  } catch {
    redirect("/email?emailConnection=email-disconnect-error" as Route);
  }

  redirect(`/email?emailConnection=${status}` as Route);
}

export async function generateEmailReplyDraftAction(
  _previousState: GenerateEmailReplyDraftActionState,
  formData: FormData
): Promise<GenerateEmailReplyDraftActionState> {
  const emailLogId = String(formData.get("emailLogId") ?? "").trim();
  const tone = String(formData.get("tone") ?? "concise").trim();

  try {
    const { actor } = await getCurrentWorkspaceContext();
    const draft = await generateEmailReplyDraft(actor, { emailLogId, tone });

    return {
      contextUsed: draft.contextUsed,
      emailLogId,
      message: "AI draft generated. Review and edit before using it.",
      replyBody: draft.body,
      subjectSuggestion: draft.subjectSuggestion,
      suggestedNextAction: draft.suggestedNextAction,
      tone: draft.tone,
      warnings: draft.warnings
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { emailLogId, error: redactSensitiveText(error.message), tone };
    }

    return { emailLogId, error: "AI reply draft could not be generated.", tone };
  }
}

export async function classifyEmailLogAction(
  _previousState: ClassifyEmailLogActionState,
  formData: FormData
): Promise<ClassifyEmailLogActionState> {
  const emailLogId = String(formData.get("emailLogId") ?? "").trim();

  try {
    const { actor } = await getCurrentWorkspaceContext();
    const classification = await classifyEmailLog(actor, { emailLogId });

    return {
      classification,
      emailLogId,
      message: "Smart labels generated. Review them before acting."
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { emailLogId, error: redactSensitiveText(error.message) };
    }

    return { emailLogId, error: "Smart Email Labels could not be generated." };
  }
}

export async function createEmailFollowUpActivityAction(
  _previousState: CreateEmailFollowUpActionState,
  formData: FormData
): Promise<CreateEmailFollowUpActionState> {
  const emailLogId = String(formData.get("emailLogId") ?? "").trim();

  try {
    const { actor } = await getCurrentWorkspaceContext();
    const result = await createEmailFollowUpActivity(actor, {
      description: formData.get("description"),
      dueAt: formData.get("dueAt"),
      emailLogId,
      title: formData.get("title"),
      type: formData.get("type")
    });

    return {
      activityHref: result.activityHref,
      activityId: result.activity.id,
      emailLogId,
      message: "Follow-up activity created.",
      targetHref: result.target.href,
      targetLabel: result.target.label
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { emailLogId, error: redactSensitiveText(error.message) };
    }

    return { emailLogId, error: "Follow-up activity could not be created." };
  }
}

async function setEmailSyncReviewCookie(review: Parameters<typeof encodeEmailSyncReview>[0]) {
  const cookieStore = await cookies();
  cookieStore.set(emailSyncReviewCookieName, encodeEmailSyncReview(review), {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/email",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}
