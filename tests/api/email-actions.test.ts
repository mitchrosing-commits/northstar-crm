import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeEmailSyncReview, emailSyncReviewCookieName } from "@/app/email/sync-review";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  getCurrentWorkspaceContext: vi.fn(),
  redirect: vi.fn(),
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
  syncRecentGmailMessages: mocks.syncRecentGmailMessages,
  syncRecentMicrosoftMessages: mocks.syncRecentMicrosoftMessages
}));

import {
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

  it("syncs Gmail, stores a temporary httpOnly review cookie, and redirects with aggregate counts", async () => {
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

  it("redirects Microsoft sync failures without writing stale review cookies", async () => {
    mocks.syncRecentMicrosoftMessages.mockRejectedValue(new Error("provider token raw-secret-token"));

    await expect(syncRecentMicrosoftFromEmailPageAction()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/email?emailConnection=microsoft-sync-error"
    });

    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
