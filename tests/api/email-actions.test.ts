import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeEmailSyncReview, emailSyncReviewCookieName } from "@/app/email/sync-review";
import { ApiError } from "@/lib/api/responses";

const mocks = vi.hoisted(() => ({
  classifyEmailLog: vi.fn(),
  cookieSet: vi.fn(),
  createEmailFollowUpActivity: vi.fn(),
  disconnectEmailConnection: vi.fn(),
  enqueueAllGmailInboxSyncJobs: vi.fn(),
  enqueueGmailInboxSyncJob: vi.fn(),
  enqueueGmailInboxSyncJobForSelectedConnection: vi.fn(),
  generateEmailReplyDraft: vi.fn(),
  getCurrentWorkspaceContext: vi.fn(),
  linkEmailLogToCrmRecord: vi.fn(),
  refreshGmailInboxThread: vi.fn(),
  sendGmailReplyFromEmailLog: vi.fn(),
  redirect: vi.fn(),
  syncOlderGmailInboxMessages: vi.fn(),
  syncRecentGmailMessages: vi.fn(),
  syncRecentMicrosoftMessages: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: mocks.cookieSet
  }))
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/auth/request-context", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext
}));

vi.mock("@/lib/services/crm", () => ({
  classifyEmailLog: mocks.classifyEmailLog,
  createEmailFollowUpActivity: mocks.createEmailFollowUpActivity,
  disconnectEmailConnection: mocks.disconnectEmailConnection,
  enqueueAllGmailInboxSyncJobs: mocks.enqueueAllGmailInboxSyncJobs,
  enqueueGmailInboxSyncJob: mocks.enqueueGmailInboxSyncJob,
  enqueueGmailInboxSyncJobForSelectedConnection:
    mocks.enqueueGmailInboxSyncJobForSelectedConnection,
  generateEmailReplyDraft: mocks.generateEmailReplyDraft,
  linkEmailLogToCrmRecord: mocks.linkEmailLogToCrmRecord,
  refreshGmailInboxThread: mocks.refreshGmailInboxThread,
  sendGmailReplyFromEmailLog: mocks.sendGmailReplyFromEmailLog,
  syncOlderGmailInboxMessages: mocks.syncOlderGmailInboxMessages,
  syncRecentGmailMessages: mocks.syncRecentGmailMessages,
  syncRecentMicrosoftMessages: mocks.syncRecentMicrosoftMessages
}));

import {
  classifyEmailLogAction,
  createEmailFollowUpActivityAction,
  disconnectEmailProviderFromEmailPageAction,
  generateEmailReplyDraftAction,
  linkEmailLogToCrmRecordFromEmailPageAction,
  loadOlderGmailInboxFromEmailPageAction,
  refreshGmailThreadFromEmailPageAction,
  syncGmailInboxFromEmailPageAction,
  syncRecentGmailFromEmailPageAction,
  syncRecentMicrosoftFromEmailPageAction
} from "@/app/email/actions";

const actor = { workspaceId: "workspace_1", actorUserId: "user_1" };

function redirectError(url: string) {
  return Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT", url });
}

function unmatchedPreview(provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365") {
  return {
    direction: "INBOUND" as const,
    email: "buyer@example.test",
    fromText: "Buyer <buyer@example.test>",
    occurredAt: "2030-01-01T12:00:00.000Z",
    provider,
    providerMessageId: `${provider.toLowerCase()}-message-1`,
    snippet: "Could not match this message.",
    subject: "Unmatched intro",
    toText: "sales@example.test"
  };
}

describe("email sync server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
  });

  it("queues a Full Inbox Gmail sync from the email page without writing a review cookie", async () => {
    mocks.enqueueGmailInboxSyncJob.mockResolvedValue({
      id: "job_queued",
      payload: { connectionId: "gmail_connection_1", workspaceId: actor.workspaceId }
    });

    await expect(syncGmailInboxFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-sync-queued&queued=1&syncStatus=1#gmail-sync-progress"
    });

    expect(mocks.enqueueGmailInboxSyncJob).toHaveBeenCalledWith(actor);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("queues all connected Gmail inboxes when unified inbox is selected", async () => {
    mocks.enqueueAllGmailInboxSyncJobs.mockResolvedValue({
      jobs: [
        { connectionId: "gmail_connection_a", id: "job_a" },
        { connectionId: "gmail_connection_b", id: "job_b" }
      ],
      queued: 2
    });
    const formData = new FormData();
    formData.set("account", "all");

    await expect(syncGmailInboxFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-sync-queued&queued=2&syncStatus=1&account=all#gmail-sync-progress"
    });

    expect(mocks.enqueueAllGmailInboxSyncJobs).toHaveBeenCalledWith(actor);
    expect(mocks.enqueueGmailInboxSyncJob).not.toHaveBeenCalled();
  });

  it("queues only the selected Gmail inbox account from the email page", async () => {
    mocks.enqueueGmailInboxSyncJobForSelectedConnection.mockResolvedValue({
      id: "job_selected",
      payload: { connectionId: "email_connection_selected", workspaceId: actor.workspaceId }
    });
    const formData = new FormData();
    formData.set("account", "email_connection_selected");

    await expect(syncGmailInboxFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-sync-queued&queued=1&syncStatus=1&account=email_connection_selected#gmail-sync-progress"
    });

    expect(mocks.enqueueGmailInboxSyncJobForSelectedConnection).toHaveBeenCalledWith(actor, "email_connection_selected");
  });

  it("keeps the legacy matched Gmail sync action available for settings", async () => {
    mocks.syncRecentGmailMessages.mockResolvedValue({
      created: 1,
      skippedDuplicates: 2,
      skippedUnmatched: 3,
      totalFetched: 6,
      unmatchedPreviews: [unmatchedPreview("GOOGLE_WORKSPACE")]
    });

    await expect(syncRecentGmailFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-synced&created=1&duplicates=2&skipped=3&total=6"
    });

    expect(mocks.syncRecentGmailMessages).toHaveBeenCalledWith({ actor, maxResults: 10 });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      emailSyncReviewCookieName,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        maxAge: 10 * 60,
        path: "/email",
        sameSite: "lax",
        secure: false
      })
    );
    expect(decodeEmailSyncReview(mocks.cookieSet.mock.calls[0]?.[1])).toEqual({
      created: 1,
      duplicates: 2,
      provider: "Gmail",
      skipped: 3,
      totalFetched: 6,
      unmatchedPreviews: [unmatchedPreview("GOOGLE_WORKSPACE")]
    });
  });

  it("loads older Gmail inbox messages without writing a review cookie", async () => {
    mocks.syncOlderGmailInboxMessages.mockResolvedValue({
      created: 2,
      skippedDuplicates: 1,
      skippedUnmatched: 0,
      totalFetched: 3,
      unmatchedPreviews: []
    });
    const formData = new FormData();
    formData.set("before", "2030-01-02T00:00:00.000Z");
    formData.set("threadId", "GOOGLE_WORKSPACE:thread_1");

    await expect(loadOlderGmailInboxFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?created=2&duplicates=1&emailConnection=gmail-loaded-more&messageSkips=0&total=3&thread=GOOGLE_WORKSPACE%3Athread_1"
    });

    expect(mocks.syncOlderGmailInboxMessages).toHaveBeenCalledWith({
      actor,
      before: "2030-01-02T00:00:00.000Z"
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("refreshes a selected Gmail thread without writing a review cookie", async () => {
    mocks.refreshGmailInboxThread.mockResolvedValue({
      created: 1,
      skippedDuplicates: 2,
      skippedUnmatched: 0,
      threadId: "thread_1",
      totalFetched: 3,
      unmatchedPreviews: []
    });
    const formData = new FormData();
    formData.set("threadId", "GOOGLE_WORKSPACE:thread_1");

    await expect(refreshGmailThreadFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?created=1&duplicates=2&emailConnection=gmail-thread-refreshed&messageSkips=0&thread=GOOGLE_WORKSPACE%3Athread_1&total=3"
    });

    expect(mocks.refreshGmailInboxThread).toHaveBeenCalledWith({
      actor,
      threadId: "GOOGLE_WORKSPACE:thread_1"
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("syncs Microsoft mail into the same temporary review-cookie flow", async () => {
    mocks.syncRecentMicrosoftMessages.mockResolvedValue({
      created: 0,
      skippedDuplicates: 1,
      skippedUnmatched: 1,
      totalFetched: 2,
      unmatchedPreviews: [unmatchedPreview("MICROSOFT_365")]
    });

    await expect(syncRecentMicrosoftFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=microsoft-synced&created=0&duplicates=1&skipped=1&total=2"
    });

    expect(mocks.syncRecentMicrosoftMessages).toHaveBeenCalledWith({ actor, maxResults: 10 });
    expect(decodeEmailSyncReview(mocks.cookieSet.mock.calls[0]?.[1])).toEqual({
      created: 0,
      duplicates: 1,
      provider: "Microsoft",
      skipped: 1,
      totalFetched: 2,
      unmatchedPreviews: [unmatchedPreview("MICROSOFT_365")]
    });
  });

  it("redirects Gmail sync failures without writing stale review cookies", async () => {
    mocks.syncRecentGmailMessages.mockRejectedValue(new Error("provider token raw-secret-token"));

    await expect(syncRecentGmailFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-sync-error"
    });

    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("redirects Full Inbox Gmail sync failures without writing stale review cookies", async () => {
    mocks.enqueueGmailInboxSyncJob.mockRejectedValue(new Error("provider token raw-secret-token"));

    await expect(syncGmailInboxFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-sync-error&syncError=provider+token+%5Bredacted%5D&syncStatus=1#gmail-sync-progress"
    });

    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("redirects Full Inbox Gmail ApiError failures with sanitized actionable detail", async () => {
    mocks.enqueueGmailInboxSyncJob.mockRejectedValue(
      new Error("EMAIL_SYNC_ALREADY_RUNNING: Gmail sync is already running. Refresh status in a moment.")
    );

    await expect(syncGmailInboxFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-sync-error&syncError=EMAIL_SYNC_ALREADY_RUNNING%3A+Gmail+sync+is+already+running.+Refresh+status+in+a+moment.&syncStatus=1#gmail-sync-progress"
    });

    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("redirects Microsoft sync failures without writing stale review cookies", async () => {
    mocks.syncRecentMicrosoftMessages.mockRejectedValue(new Error("provider token raw-secret-token"));

    await expect(syncRecentMicrosoftFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=microsoft-sync-error"
    });

    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("disconnects an email provider through a workspace-scoped server action", async () => {
    mocks.disconnectEmailConnection.mockResolvedValue({
      accountEmail: "alex@example.test",
      provider: "GOOGLE_WORKSPACE"
    });
    const formData = new FormData();
    formData.set("provider", "GOOGLE_WORKSPACE");

    await expect(disconnectEmailProviderFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-disconnected"
    });

    expect(mocks.disconnectEmailConnection).toHaveBeenCalledWith(actor, "GOOGLE_WORKSPACE");
  });

  it("disconnects only the selected Gmail inbox connection when provided", async () => {
    mocks.disconnectEmailConnection.mockResolvedValue({
      accountEmail: "alex@example.test",
      provider: "GOOGLE_WORKSPACE"
    });
    const formData = new FormData();
    formData.set("provider", "GOOGLE_WORKSPACE");
    formData.set("connectionId", "email_connection_selected");

    await expect(disconnectEmailProviderFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=gmail-disconnected"
    });

    expect(mocks.disconnectEmailConnection).toHaveBeenCalledWith(
      actor,
      "GOOGLE_WORKSPACE",
      "email_connection_selected"
    );
  });

  it("redirects email disconnect failures without leaking provider details", async () => {
    mocks.disconnectEmailConnection.mockRejectedValue(new Error("raw-oauth-token"));
    const formData = new FormData();
    formData.set("provider", "GOOGLE_WORKSPACE");

    await expect(disconnectEmailProviderFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=email-disconnect-error"
    });
  });

  it("generates review-first AI reply drafts through the current workspace context", async () => {
    mocks.generateEmailReplyDraft.mockResolvedValue({
      body: "Hi there,\n\nThanks for reaching out.",
      contextUsed: ["Email subject and body", "Contact"],
      subjectSuggestion: "Re: Hello",
      suggestedNextAction: "Create a follow-up activity.",
      tone: "warm",
      warnings: ["Review before sending."]
    });
    const formData = new FormData();
    formData.set("emailLogId", " email_log_1 ");
    formData.set("tone", "warm");

    await expect(generateEmailReplyDraftAction({}, formData)).resolves.toEqual({
      contextUsed: ["Email subject and body", "Contact"],
      emailLogId: "email_log_1",
      message: "AI draft generated. Review and edit before using it.",
      replyBody: "Hi there,\n\nThanks for reaching out.",
      subjectSuggestion: "Re: Hello",
      suggestedNextAction: "Create a follow-up activity.",
      tone: "warm",
      warnings: ["Review before sending."]
    });

    expect(mocks.generateEmailReplyDraft).toHaveBeenCalledWith(actor, {
      emailLogId: "email_log_1",
      tone: "warm"
    });
  });

  it("redacts AI reply generation errors", async () => {
    mocks.generateEmailReplyDraft.mockRejectedValue(new Error("provider failed with raw-secret-token"));
    const formData = new FormData();
    formData.set("emailLogId", "email_log_1");

    await expect(generateEmailReplyDraftAction({}, formData)).resolves.toEqual({
      emailLogId: "email_log_1",
      error: "AI reply draft could not be generated.",
      tone: "concise"
    });
  });

  it("returns retryable AI reply rate-limit state without exposing provider diagnostics", async () => {
    mocks.generateEmailReplyDraft.mockRejectedValue(
      new ApiError(
        "AI_EMAIL_REPLY_PROVIDER_RATE_LIMITED",
        "AI email reply provider is still rate limited after retrying. Try again in about 20 seconds.",
        503,
        {
          providerMessage: "Provider rate limit was reached.",
          rawHeader: "Authorization: Bearer sk-should-not-leak",
          retryable: true,
          retryAfterSeconds: 20
        }
      )
    );
    const formData = new FormData();
    formData.set("emailLogId", "email_log_1");
    formData.set("tone", "warm");

    await expect(generateEmailReplyDraftAction({}, formData)).resolves.toEqual({
      emailLogId: "email_log_1",
      error: "AI email reply provider is still rate limited after retrying. Try again in about 20 seconds.",
      retryAfterSeconds: 20,
      retryLabel: "Try again in about 20 seconds.",
      retryable: true,
      tone: "warm"
    });
  });

  it("classifies stored emails with smart labels through the current workspace context", async () => {
    const generatedAt = new Date("2030-01-04T12:00:00.000Z");
    mocks.classifyEmailLog.mockResolvedValue({
      category: "CUSTOMER",
      cautions: ["Suggested label only."],
      confidence: 0.86,
      evidence: ["Inbound customer email asks for quote timing."],
      generatedAt,
      providerId: "test-provider",
      providerName: "Test provider",
      signalEvidence: [
        {
          excerpts: ["asks for quote timing"],
          reason: "The customer asks a direct pricing question.",
          signal: "PRICING_QUOTE"
        }
      ],
      signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE"],
      summary: "Urgent customer pricing email that needs a reply."
    });
    const formData = new FormData();
    formData.set("emailLogId", " email_log_2 ");

    await expect(classifyEmailLogAction({}, formData)).resolves.toEqual({
      classification: {
        category: "CUSTOMER",
        cautions: ["Suggested label only."],
        confidence: 0.86,
        evidence: ["Inbound customer email asks for quote timing."],
        generatedAt,
        providerId: "test-provider",
        providerName: "Test provider",
        signalEvidence: [
          {
            excerpts: ["asks for quote timing"],
            reason: "The customer asks a direct pricing question.",
            signal: "PRICING_QUOTE"
          }
        ],
        signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE"],
        summary: "Urgent customer pricing email that needs a reply."
      },
      emailLogId: "email_log_2",
      message: "Smart labels generated. Review them before acting."
    });

    expect(mocks.classifyEmailLog).toHaveBeenCalledWith(actor, { emailLogId: "email_log_2" });
  });

  it("redacts smart-label classification errors", async () => {
    mocks.classifyEmailLog.mockRejectedValue(new Error("provider failed with raw-secret-token"));
    const formData = new FormData();
    formData.set("emailLogId", "email_log_2");

    await expect(classifyEmailLogAction({}, formData)).resolves.toEqual({
      emailLogId: "email_log_2",
      error: "Smart Email Labels could not be generated."
    });
  });

  it("reports local smart-label fallback as a graceful refinement notice", async () => {
    const generatedAt = new Date("2030-01-04T12:00:00.000Z");
    mocks.classifyEmailLog.mockResolvedValue({
      category: "PROSPECT",
      cautions: ["Suggested label only."],
      confidence: 0.64,
      evidence: ["Local labels: Needs reply, Pricing / quote, No CRM link."],
      generatedAt,
      providerId: "local_rules",
      providerName: "Local rules",
      signalEvidence: [],
      signals: ["NEEDS_REPLY", "PRICING_QUOTE", "POTENTIAL_LEAD"],
      summary: "Local rules suggest Needs reply, Pricing / quote, No CRM link."
    });
    const formData = new FormData();
    formData.set("emailLogId", "email_log_2");

    await expect(classifyEmailLogAction({}, formData)).resolves.toMatchObject({
      classification: expect.objectContaining({ providerId: "local_rules" }),
      emailLogId: "email_log_2",
      message: "AI refinement is unavailable right now. Northstar generated local labels instead."
    });
  });

  it("links a stored email to a reviewed CRM record and preserves the email view", async () => {
    mocks.linkEmailLogToCrmRecord.mockResolvedValue({ id: "email_log_7" });
    const formData = new FormData();
    formData.set("emailLogId", " email_log_7 ");
    formData.set("recordType", "PERSON");
    formData.set("recordId", " person_1 ");
    formData.set("returnTo", "/email?inbox=potential-leads&q=veridian#email-card-email_log_7");

    await expect(linkEmailLogToCrmRecordFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?inbox=potential-leads&q=veridian&emailConnection=crm-linked#email-card-email_log_7"
    });

    expect(mocks.linkEmailLogToCrmRecord).toHaveBeenCalledWith(actor, {
      emailLogId: "email_log_7",
      recordId: "person_1",
      recordType: "PERSON"
    });
  });

  it("keeps CRM link failures on the email card without leaking service details", async () => {
    mocks.linkEmailLogToCrmRecord.mockRejectedValue(new Error("workspace token raw-secret-token"));
    const formData = new FormData();
    formData.set("emailLogId", "email_log_8");
    formData.set("recordType", "DEAL");
    formData.set("recordId", "deal_1");
    formData.set("returnTo", "/email?inbox=urgent");

    await expect(linkEmailLogToCrmRecordFromEmailPageAction(formData)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?inbox=urgent&emailConnection=crm-link-error#email-card-email_log_8"
    });
  });

  it("creates reviewed email follow-up activities through the current workspace context", async () => {
    mocks.createEmailFollowUpActivity.mockResolvedValue({
      activity: { id: "activity_1" },
      activityHref: "/activities/activity_1/edit?returnTo=%2Femail",
      target: {
        href: "/deals/deal_1",
        label: "Deal: Acme Expansion"
      }
    });
    const formData = new FormData();
    formData.set("emailLogId", " email_log_3 ");
    formData.set("title", " Reply to quote question ");
    formData.set("type", "EMAIL");
    formData.set("dueAt", "2030-01-07");
    formData.set("description", " Review pricing first. ");

    await expect(createEmailFollowUpActivityAction({}, formData)).resolves.toEqual({
      activityHref: "/activities/activity_1/edit?returnTo=%2Femail",
      activityId: "activity_1",
      emailLogId: "email_log_3",
      message: "Follow-up activity created.",
      targetHref: "/deals/deal_1",
      targetLabel: "Deal: Acme Expansion"
    });

    expect(mocks.createEmailFollowUpActivity).toHaveBeenCalledWith(actor, {
      description: " Review pricing first. ",
      dueAt: "2030-01-07",
      emailLogId: "email_log_3",
      title: " Reply to quote question ",
      type: "EMAIL"
    });
  });

  it("redacts email follow-up creation errors", async () => {
    mocks.createEmailFollowUpActivity.mockRejectedValue(new Error("activity failed with raw-secret-token"));
    const formData = new FormData();
    formData.set("emailLogId", "email_log_3");

    await expect(createEmailFollowUpActivityAction({}, formData)).resolves.toEqual({
      emailLogId: "email_log_3",
      error: "Follow-up activity could not be created."
    });
  });
});
