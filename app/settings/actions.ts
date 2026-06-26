"use server";

import { redirect } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { syncRecentGmailMessages, syncRecentMicrosoftMessages } from "@/lib/services/crm";

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
