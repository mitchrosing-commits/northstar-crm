"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { applyCrmChangeProposal, rejectCrmChangeProposal } from "@/lib/services/crm";

export async function applyCrmChangeProposalAction(formData: FormData) {
  const proposalId = stringValue(formData.get("proposalId"));
  const fields = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([key]) => key.startsWith("field."))
      .map(([key, value]) => [key.slice("field.".length), stringValue(value)])
  );
  const organizationId = stringValue(formData.get("organizationId"));
  const { actor } = await getCurrentWorkspaceContext();

  try {
    await applyCrmChangeProposal(actor, proposalId, organizationId ? { organizationId } : { fields });
  } catch {
    revalidatePath(`/crm-change-proposals/${proposalId}`);
    redirect(`/crm-change-proposals/${proposalId}?status=apply-error` as Route);
  }

  revalidatePath("/crm-change-proposals");
  revalidatePath(`/crm-change-proposals/${proposalId}`);
  redirect(`/crm-change-proposals/${proposalId}?status=applied` as Route);
}

export async function rejectCrmChangeProposalAction(formData: FormData) {
  const proposalId = stringValue(formData.get("proposalId"));
  const { actor } = await getCurrentWorkspaceContext();

  try {
    await rejectCrmChangeProposal(actor, proposalId);
  } catch {
    revalidatePath(`/crm-change-proposals/${proposalId}`);
    redirect(`/crm-change-proposals/${proposalId}?status=reject-error` as Route);
  }

  revalidatePath("/crm-change-proposals");
  revalidatePath(`/crm-change-proposals/${proposalId}`);
  redirect(`/crm-change-proposals/${proposalId}?status=rejected` as Route);
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}
