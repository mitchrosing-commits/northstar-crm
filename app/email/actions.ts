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
  generateEmailReplyDraft,
  refreshGmailInboxThread,
  runAllGmailInboxSyncNow,
  runGmailInboxSyncNow,
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
  retryAfterSeconds?: number;
  retryLabel?: string;
  retryable?: boolean;
  message?: string;
  replyBody?: string;
  subjectSuggestion?: string;
  suggestedNextAction?: string;
  tone?: string;
  warnings?: string[];
};

export async function syncGmailInboxFromEmailPageAction(formData?: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const selectedAccount = normalizeInboxAccountSelection(formData?.get("account"));
  const returnTo = normalizeEmailPageReturnTo(formData?.get("returnTo"));
  let result: Awaited<ReturnType<typeof runGmailInboxSyncNow>>;

  try {
    result =
      selectedAccount === "all"
        ? await runAllGmailInboxSyncNow(actor)
        : selectedAccount
          ? await runGmailInboxSyncNow(actor, { connectionId: selectedAccount })
          : await runGmailInboxSyncNow(actor);
  } catch (error) {
    const params = new URLSearchParams({
      emailConnection: "gmail-sync-error",
      syncError: safeGmailSyncActionError(error),
      syncStatus: "1"
    });
    addSelectedInboxAccountParam(params, selectedAccount);
    redirect(emailActionRedirectHref(params, returnTo, "gmail-sync-progress"));
  }

  const params = new URLSearchParams({
    created: String(result.created),
    duplicates: String(result.skippedDuplicates),
    emailConnection: "gmail-synced",
    messageSkips: String(result.skippedMessageFailures ?? 0),
    skipped: String(result.skippedUnmatched),
    syncStatus: "1",
    total: String(result.totalFetched)
  });
  if (result.syncWarning) params.set("syncWarning", result.syncWarning);
  addSelectedInboxAccountParam(params, selectedAccount);
  redirect(emailActionRedirectHref(params, returnTo, "gmail-sync-progress"));
}

function safeGmailSyncActionError(error: unknown) {
  const message =
    error instanceof ApiError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "Gmail sync failed before inbox threads were stored.";
  return truncateSyncError(redactGmailSyncActionSecrets(redactSensitiveText(message)));
}

function truncateSyncError(message: string) {
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function redactGmailSyncActionSecrets(message: string) {
  return message
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]")
    .replace(/\b(access[_ -]?token|refresh[_ -]?token|id[_ -]?token|token|secret)([:=]\s*)[^\s&]+/gi, "$1$2[redacted]")
    .replace(
      /\b(access[_ -]?token|refresh[_ -]?token|id[_ -]?token|token|secret)(\s+)([^\s&]+)/gi,
      (match, label: string, spacing: string, value: string) =>
        isSecretLikeSyncErrorValue(value) ? `${label}${spacing}[redacted]` : match
    );
}

function isSecretLikeSyncErrorValue(value: string) {
  return value.length >= 12 || /[-_.+/=]/.test(value) || /^eyJ/i.test(value);
}

export async function loadOlderGmailInboxFromEmailPageAction(formData: FormData) {
  const before = String(formData.get("before") ?? "").trim();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const selectedAccount = normalizeInboxAccountSelection(formData.get("account"));
  const returnTo = normalizeEmailPageReturnTo(formData.get("returnTo"));
  const { actor } = await getCurrentWorkspaceContext();
  let result: Awaited<ReturnType<typeof syncOlderGmailInboxMessages>>;

  try {
    result =
      selectedAccount && selectedAccount !== "all"
        ? await syncOlderGmailInboxMessages({ actor, before, connectionId: selectedAccount })
        : await syncOlderGmailInboxMessages({ actor, before });
  } catch {
    const params = new URLSearchParams({ emailConnection: "gmail-load-more-error" });
    if (threadId) params.set("thread", threadId);
    addSelectedInboxAccountParam(params, selectedAccount);
    redirect(emailActionRedirectHref(params, returnTo));
  }

  const params = new URLSearchParams({
    created: String(result.created),
    duplicates: String(result.skippedDuplicates),
    emailConnection: "gmail-loaded-more",
    messageSkips: String(result.skippedMessageFailures ?? 0),
    total: String(result.totalFetched)
  });
  if (threadId) params.set("thread", threadId);
  addSelectedInboxAccountParam(params, selectedAccount);
  redirect(emailActionRedirectHref(params, returnTo));
}

export async function refreshGmailThreadFromEmailPageAction(formData: FormData) {
  const threadId = String(formData.get("threadId") ?? "").trim();
  const selectedAccount = normalizeInboxAccountSelection(formData.get("account"));
  const returnTo = normalizeEmailPageReturnTo(formData.get("returnTo"));
  const { actor } = await getCurrentWorkspaceContext();
  let result: Awaited<ReturnType<typeof refreshGmailInboxThread>>;

  try {
    result = await refreshGmailInboxThread({ actor, threadId });
  } catch {
    const params = new URLSearchParams({ emailConnection: "gmail-thread-refresh-error" });
    if (threadId) params.set("thread", threadId);
    addSelectedInboxAccountParam(params, selectedAccount);
    redirect(emailActionRedirectHref(params, returnTo));
  }

  const params = new URLSearchParams({
    created: String(result.created),
    duplicates: String(result.skippedDuplicates),
    emailConnection: "gmail-thread-refreshed",
    messageSkips: String(result.skippedMessageFailures ?? 0),
    thread: threadId,
    total: String(result.totalFetched)
  });
  addSelectedInboxAccountParam(params, selectedAccount);
  redirect(emailActionRedirectHref(params, returnTo));
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
  const returnTo = normalizeEmailPageReturnTo(formData.get("returnTo"));

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
    redirect(emailActionRedirectHref(params, returnTo));
  }

  const params = new URLSearchParams({ emailConnection: "gmail-reply-sent" });
  if (threadId) params.set("thread", threadId);
  redirect(emailActionRedirectHref(params, returnTo));
}

export async function disconnectEmailProviderFromEmailPageAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "").trim();
  const connectionId = normalizeInboxAccountSelection(formData.get("connectionId"));
  let status: "gmail-disconnected" | "microsoft-disconnected";

  try {
    const { actor } = await getCurrentWorkspaceContext();
    const result =
      connectionId && connectionId !== "all"
        ? await disconnectEmailConnection(actor, provider, connectionId)
        : await disconnectEmailConnection(actor, provider);
    status = result.provider === "MICROSOFT_365" ? "microsoft-disconnected" : "gmail-disconnected";
  } catch {
    redirect("/email?emailConnection=email-disconnect-error" as Route);
  }

  redirect(`/email?emailConnection=${status}` as Route);
}

function normalizeInboxAccountSelection(value: unknown) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || selected === "all") return selected === "all" ? "all" : null;
  return selected;
}

function addSelectedInboxAccountParam(params: URLSearchParams, selectedAccount: string | null) {
  if (selectedAccount) params.set("account", selectedAccount);
}

function normalizeEmailPageReturnTo(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1200 || !trimmed.startsWith("/email")) {
    return null;
  }
  try {
    const url = new URL(trimmed, "https://northstar.local");
    return url.pathname === "/email"
      ? (`${url.pathname}${url.search}${url.hash}` as Route)
      : null;
  } catch {
    return null;
  }
}

function emailActionRedirectHref(
  params: URLSearchParams,
  returnTo: Route | null,
  fallbackHash?: string,
) {
  const url = new URL(returnTo ?? "/email", "https://northstar.local");
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  if (!url.hash && fallbackHash) url.hash = fallbackHash;
  return `${url.pathname}${url.search}${url.hash}` as Route;
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
      const retryAfterSeconds = emailReplyRetryAfterSeconds(error);
      return {
        emailLogId,
        error: redactSensitiveText(error.message),
        retryAfterSeconds,
        retryLabel: retryAfterSeconds ? `Try again in about ${retryAfterSeconds} ${retryAfterSeconds === 1 ? "second" : "seconds"}.` : undefined,
        retryable: isRetryableEmailReplyError(error),
        tone
      };
    }

    return { emailLogId, error: "AI reply draft could not be generated.", tone };
  }
}

function isRetryableEmailReplyError(error: ApiError) {
  const details = error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {};
  return error.code === "AI_EMAIL_REPLY_PROVIDER_RATE_LIMITED" || details.retryable === true;
}

function emailReplyRetryAfterSeconds(error: ApiError) {
  const details = error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {};
  const seconds = details.retryAfterSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
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
      message:
        classification.providerId === "local_rules"
          ? "AI refinement is unavailable right now. Northstar generated local labels instead."
          : "Smart labels generated. Review them before acting."
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { emailLogId, error: "Smart Email Labels could not be generated. Local suggestions remain available when the email has enough context." };
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
