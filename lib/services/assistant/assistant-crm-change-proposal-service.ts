import { createHash } from "node:crypto";

import { CrmChangeProposalType } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { createCrmChangeProposal } from "@/lib/services/crm-change-proposal-service";
import type { AssistantDraftAction } from "@/lib/services/assistant/assistant-draft-action-service";
import type { WorkspaceActor } from "@/lib/services/workspace-access";

type AssistantCrmProposalResult = {
  href: string;
  id: string;
};

export function isAssistantCrmChangeProposalDraft(draft: AssistantDraftAction) {
  return draft.kind === "contact_create" ||
    draft.kind === "contact_organization_link" ||
    draft.kind === "contact_update" ||
    draft.kind === "organization_create" ||
    draft.kind === "organization_update";
}

export async function createCrmChangeProposalFromAssistantDraft(
  actor: WorkspaceActor,
  input: { draftAction: AssistantDraftAction; sourceCommand?: string }
): Promise<AssistantCrmProposalResult> {
  const draft = input.draftAction;
  if (!isAssistantCrmChangeProposalDraft(draft) || !draft.proposal) {
    throw new ApiError("VALIDATION_ERROR", "Assistant draft is not a supported CRM change proposal.", 422);
  }
  const proposal = await createCrmChangeProposal(actor, {
    confidence: draft.confidence,
    evidence: draft.evidence,
    idempotencyKey: assistantCrmProposalIdempotencyKey(draft),
    proposedPayload: proposedPayloadForDraft(draft),
    proposalType: proposalTypeForDraft(draft),
    rationale: [draft.title, draft.evidence[0]].filter(Boolean).join(": "),
    sourceLabel: "Assistant conversation",
    sourceType: "assistant",
    targetEntityId: draft.proposal.targetRecordId,
    warnings: draft.warnings
  });
  return {
    href: `/crm-change-proposals/${proposal.id}`,
    id: proposal.id
  };
}

function proposalTypeForDraft(draft: AssistantDraftAction) {
  if (draft.kind === "contact_create") return CrmChangeProposalType.CREATE_PERSON;
  if (draft.kind === "contact_update") return CrmChangeProposalType.UPDATE_PERSON;
  if (draft.kind === "contact_organization_link") return CrmChangeProposalType.LINK_PERSON_ORGANIZATION;
  if (draft.kind === "organization_create") return CrmChangeProposalType.CREATE_ORGANIZATION;
  if (draft.kind === "organization_update") return CrmChangeProposalType.UPDATE_ORGANIZATION;
  throw new ApiError("VALIDATION_ERROR", "Assistant draft type is unsupported for CRM proposals.", 422);
}

function proposedPayloadForDraft(draft: AssistantDraftAction) {
  const fields = nonEmptyFields(draft.proposal?.fields ?? {});
  if (draft.kind === "contact_organization_link") {
    return { organizationId: fields.organizationId };
  }
  if (draft.kind === "organization_create") {
    return { fields: pick(fields, ["domain", "name"]) };
  }
  if (draft.kind === "organization_update") {
    return { fields: pick(fields, ["domain", "name"]) };
  }
  return { fields: pick(fields, ["email", "firstName", "lastName", "organizationId", "phone"]) };
}

function nonEmptyFields(fields: Record<string, string | null>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => typeof value === "string" && value.trim())
  ) as Record<string, string>;
}

function pick(fields: Record<string, string>, keys: string[]) {
  return Object.fromEntries(keys.flatMap((key) => fields[key] ? [[key, fields[key]]] : []));
}

function assistantCrmProposalIdempotencyKey(draft: AssistantDraftAction) {
  return `assistant:${createHash("sha256").update(JSON.stringify({
    kind: draft.kind,
    payload: proposedPayloadForDraft(draft),
    secondaryRecordId: draft.proposal?.secondaryRecordId ?? "",
    targetRecordId: draft.proposal?.targetRecordId ?? "new"
  })).digest("hex")}`;
}
