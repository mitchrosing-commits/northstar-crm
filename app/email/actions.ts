"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { syncRecentGmailMessages, syncRecentMicrosoftMessages } from "@/lib/services/crm";

export async function syncRecentGmailFromEmailPageAction() {
  const { actor } = await getCurrentWorkspaceContext();
  let result: Awaited<ReturnType<typeof syncRecentGmailMessages>>;

  try {
    result = await syncRecentGmailMessages({ actor, maxResults: 10 });
  } catch {
    redirect("/email?emailConnection=gmail-sync-error" as Route);
  }

  redirect(
    `/email?emailConnection=gmail-synced&created=${result.created}&duplicates=${result.skippedDuplicates}&skipped=${result.skippedUnmatched}` as Route
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

  redirect(
    `/email?emailConnection=microsoft-synced&created=${result.created}&duplicates=${result.skippedDuplicates}&skipped=${result.skippedUnmatched}` as Route
  );
}
