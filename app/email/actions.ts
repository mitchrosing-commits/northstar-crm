"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { cookies } from "next/headers";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { syncRecentGmailMessages, syncRecentMicrosoftMessages } from "@/lib/services/crm";
import { emailSyncReviewCookieName, encodeEmailSyncReview } from "./sync-review";

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
