import Link from "next/link";
import type { Route } from "next";

import {
  cancelAssistantDraftClarificationAction,
  clarifyAssistantDraftAction,
  saveAssistantDraftActionRequest
} from "@/app/assistant/actions";
import { Badge } from "@/components/badge";
import type { CrmChangeProposalView } from "@/lib/services/crm-change-proposal-service";
import type { AssistantDraftAction } from "@/lib/services/assistant/assistant-draft-action-service";

export function AssistantDraftActionCard({
  conversationId = "",
  crmProposal = null,
  draft,
  sourceCommand
}: {
  conversationId?: string;
  crmProposal?: CrmChangeProposalView | null;
  draft: AssistantDraftAction;
  sourceCommand: string;
}) {
  const canClarify = Boolean(conversationId && draft.clarification?.status === "needs_selection");
  const lifecycle = draftLifecycle(draft, crmProposal);
  const canSaveDraft = !crmProposal && !isBlockedCrmClarificationDraft(draft);
  return (
    <article className="assistant-draft-card" aria-label={`${draft.title}: ${draft.reviewLabel}`}>
      <header className="assistant-draft-card-header">
        <div>
          <span className="assistant-draft-eyebrow">{draft.targetKind}</span>
          <h3>{draft.title}</h3>
        </div>
        <div className="assistant-draft-badges" aria-label="Draft action status">
          <Badge>{draft.reviewLabel}</Badge>
          <Badge>{lifecycle.label}</Badge>
          <Badge>Review required</Badge>
        </div>
      </header>

      <div className={`assistant-lifecycle-row assistant-lifecycle-row-${lifecycle.tone}`} aria-label="Assistant lifecycle status">
        <Badge>{lifecycle.label}</Badge>
        <span>
          {lifecycle.reason}
          {" "}
          Next action: {lifecycle.nextAction}.
        </span>
      </div>

      <dl className="assistant-draft-meta">
        <div>
          <dt>Target</dt>
          <dd>
            {draft.targetHref ? (
              <Link className="inline-link" href={draft.targetHref as Route}>
                {draft.targetLabel}
              </Link>
            ) : (
              draft.targetLabel
            )}
          </dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{confidenceLabel(draft.confidence)}</dd>
        </div>
        <div>
          <dt>Apply</dt>
          <dd>{draftApplyLabel(draft)}</dd>
        </div>
        {lifecycle.selectedLabel ? (
          <div>
            <dt>Selected</dt>
            <dd>
              {lifecycle.selectedHref ? (
                <Link className="inline-link" href={lifecycle.selectedHref as Route}>
                  {lifecycle.selectedLabel}
                </Link>
              ) : (
                lifecycle.selectedLabel
              )}
            </dd>
          </div>
        ) : null}
        {crmProposal ? (
          <div>
            <dt>Proposal</dt>
            <dd>
              <Link className="inline-link" href={`/crm-change-proposals/${crmProposal.id}` as Route}>
                {crmProposal.status === "PENDING" ? "Review proposal" : "Open proposal"}
              </Link>
            </dd>
          </div>
        ) : null}
        {crmProposal?.appliedHref ? (
          <div>
            <dt>Applied record</dt>
            <dd>
              <Link className="inline-link" href={crmProposal.appliedHref as Route}>
                {crmProposal.appliedLabel ?? "Applied CRM record"}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="assistant-draft-field-list" aria-label="Proposed fields">
        {draft.fields.map((field) => (
          <div className="assistant-draft-field" key={`${draft.id}-${field.label}`}>
            <span>{field.label}</span>
            <strong>{field.value}</strong>
            {field.currentValue ? <small>Current: {field.currentValue}</small> : null}
          </div>
        ))}
      </div>

      {draft.candidates.length > 0 ? (
        <div className="assistant-draft-section" aria-label="Candidate records">
          <strong>Candidates to review</strong>
          <ul>
            {draft.candidates.map((candidate) => (
              <li key={`${draft.id}-${candidate.type}-${candidate.id}`}>
                <Link className="inline-link" href={candidate.href as Route}>
                  {candidate.label}
                </Link>
                {candidate.detail ? <small>{candidate.detail}</small> : null}
                {canClarify && canUseCandidateForClarification(draft, candidate.type) ? (
                  <form action={clarifyAssistantDraftAction} className="assistant-draft-inline-form">
                    <input name="conversationId" type="hidden" value={conversationId} />
                    <input name="draftAction" type="hidden" value={JSON.stringify(draft)} />
                    <input name="candidateId" type="hidden" value={candidate.id} />
                    <input name="candidateType" type="hidden" value={candidate.type} />
                    <button className="button-secondary button-compact" type="submit">
                      Use this {candidate.type === "person" ? "contact" : "organization"}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.missingInfo.length > 0 || draft.warnings.length > 0 ? (
        <div className="assistant-draft-section assistant-draft-review-notes" aria-label="Draft review notes">
          <strong>Review notes</strong>
          <ul>
            {[...draft.missingInfo, ...draft.warnings].map((warning) => (
              <li key={`${draft.id}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.evidence.length > 0 ? (
        <div className="assistant-draft-section" aria-label="Draft evidence">
          <strong>Evidence</strong>
          <ul>
            {draft.evidence.map((evidence) => (
              <li key={`${draft.id}-${evidence}`}>{evidence}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {crmProposal ? (
        <div className="assistant-draft-actions">
          <Link className="button-secondary" href={`/crm-change-proposals/${crmProposal.id}` as Route}>
            {crmProposal.status === "PENDING" ? "Review proposal" : "Open proposal"}
          </Link>
          {crmProposal.appliedHref ? (
            <Link className="button-secondary" href={crmProposal.appliedHref as Route}>
              Open record
            </Link>
          ) : null}
          <small>{proposalLifecycleHelp(crmProposal)}</small>
        </div>
      ) : canSaveDraft ? (
        <form action={saveAssistantDraftActionRequest} className="assistant-draft-actions">
          <input name="draftAction" type="hidden" value={JSON.stringify(draft)} />
          <input name="sourceCommand" type="hidden" value={sourceCommand} />
          <input name="returnCommand" type="hidden" value={sourceCommand} />
          <button className="button-secondary" type="submit">
            Save to review queue
          </button>
          <small>{draftApplyHelp(draft)}</small>
        </form>
      ) : (
        <div className="assistant-draft-actions">
          <small>{draftApplyHelp(draft)}</small>
        </div>
      )}
      {canClarify ? (
        <form action={cancelAssistantDraftClarificationAction} className="assistant-draft-actions assistant-draft-cancel-form">
          <input name="conversationId" type="hidden" value={conversationId} />
          <input name="draftAction" type="hidden" value={JSON.stringify(draft)} />
          <button className="button-secondary" type="submit">
            Cancel clarification
          </button>
          <small>No proposal will be created.</small>
        </form>
      ) : null}
    </article>
  );
}

function confidenceLabel(confidence: AssistantDraftAction["confidence"]) {
  if (confidence === "needs_clarification") return "Needs clarification";
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

function draftApplyLabel(draft: AssistantDraftAction) {
  if (isBlockedCrmClarificationDraft(draft)) return "Choose candidate first";
  if (isPotentiallyApplyableDraft(draft)) return "Save, then review";
  if (draft.kind === "activity" || draft.kind === "note") return "Needs clearer target";
  return "Review-only for now";
}

function draftApplyHelp(draft: AssistantDraftAction) {
  if (isBlockedCrmClarificationDraft(draft)) {
    if (hasStaleCandidateWarning(draft)) {
      return "No proposal was created. Retry safely or choose another available candidate before creating a CRM Change Proposal.";
    }
    return "Choose a candidate first. No CRM Change Proposal will be created until the target is clear.";
  }
  if (isPotentiallyApplyableDraft(draft)) {
    return "Saving does not apply changes. After review, this eligible proposal can be applied from the queue.";
  }
  if (draft.kind === "activity" || draft.kind === "note") {
    return "Saving does not apply changes. Apply stays blocked until one clear target and all required information are present.";
  }
  return "Saving does not apply changes. This draft is review-only for now and cannot be applied from the queue.";
}

function isPotentiallyApplyableDraft(draft: AssistantDraftAction) {
  return (
    draft.kind === "activity" ||
    draft.kind === "contact_create" ||
    draft.kind === "contact_organization_link" ||
    draft.kind === "contact_update" ||
    draft.kind === "note" ||
    draft.kind === "organization_create" ||
    draft.kind === "organization_update"
  ) &&
    draft.confidence === "high" &&
    (Boolean(draft.targetHref) || draft.kind === "contact_create" || draft.kind === "organization_create") &&
    draft.missingInfo.length === 0;
}

function canUseCandidateForClarification(draft: AssistantDraftAction, candidateType: string) {
  return draft.clarification?.slots.some((slot) => !slot.selectedRecordId && slot.candidateType === candidateType);
}

function draftLifecycle(draft: AssistantDraftAction, proposal: CrmChangeProposalView | null) {
  if (proposal) return proposalLifecycle(proposal);
  if (hasStaleCandidateWarning(draft)) {
    return {
      label: "Candidate stale or deleted",
      nextAction: "retry safely or choose another available candidate",
      reason: [...draft.missingInfo, ...draft.warnings][0] ?? "The selected record is no longer available.",
      selectedHref: undefined,
      selectedLabel: selectedRecordLabel(draft),
      tone: "warning" as const
    };
  }
  if (draft.clarification?.status === "needs_selection") {
    return {
      label: "Awaiting clarification",
      nextAction: "choose a candidate",
      reason: draft.clarification.slots.find((slot) => !slot.selectedRecordId)?.label ?? "A matching record must be selected before this can become a proposal.",
      selectedHref: undefined,
      selectedLabel: undefined,
      tone: "warning" as const
    };
  }
  if (draft.clarification?.status === "resolved") {
    return {
      label: "Clarification resolved",
      nextAction: "review and create the CRM Change Proposal",
      reason: "The original request is resumed with the selected CRM record.",
      selectedHref: draft.targetHref,
      selectedLabel: selectedRecordLabel(draft),
      tone: "success" as const
    };
  }
  if (draft.confidence === "needs_clarification") {
    return {
      label: "Awaiting clarification",
      nextAction: "resolve the missing information",
      reason: draft.missingInfo[0] ?? "This draft needs one clear target or supported field before it can be applied.",
      selectedHref: undefined,
      selectedLabel: selectedRecordLabel(draft),
      tone: "warning" as const
    };
  }
  return {
    label: "Draft ready for review",
    nextAction: "save for review",
    reason: "Nothing has been applied. Review-first handling is still required.",
    selectedHref: draft.targetHref,
    selectedLabel: selectedRecordLabel(draft),
    tone: "neutral" as const
  };
}

function proposalLifecycle(proposal: CrmChangeProposalView) {
  const proposalHref = `/crm-change-proposals/${proposal.id}`;
  if (proposal.status === "APPLIED") {
    return {
      label: "Proposal applied",
      nextAction: proposal.appliedHref ? "open the applied CRM record" : "open the proposal",
      reason: "This CRM Change Proposal was applied after review.",
      selectedHref: proposal.appliedHref ?? proposalHref,
      selectedLabel: proposal.appliedLabel ?? proposal.targetLabel,
      tone: "success" as const
    };
  }
  if (proposal.status === "REJECTED") {
    return {
      label: "Proposal rejected",
      nextAction: "open the proposal or dismiss",
      reason: "This CRM Change Proposal was rejected and will not apply changes.",
      selectedHref: proposal.targetHref ?? proposalHref,
      selectedLabel: proposal.targetLabel,
      tone: "neutral" as const
    };
  }
  if (proposal.status === "FAILED" || proposal.status === "SUPERSEDED") {
    return {
      label: "Proposal failed or stale",
      nextAction: "open the proposal and retry safely if still needed",
      reason: proposal.conflictInfo?.message ?? proposal.warnings[0] ?? "This proposal could not be applied in its current state.",
      selectedHref: proposal.targetHref ?? proposalHref,
      selectedLabel: proposal.targetLabel,
      tone: "danger" as const
    };
  }
  if (proposal.permissionState === "blocked") {
    return {
      label: "Permission denied",
      nextAction: "review AI Preferences or open the proposal",
      reason: proposal.permissionReason,
      selectedHref: proposal.targetHref ?? proposalHref,
      selectedLabel: proposal.targetLabel,
      tone: "danger" as const
    };
  }
  return {
    label: "CRM Change Proposal pending review",
    nextAction: "review the proposal",
    reason: "A durable CRM Change Proposal exists. It will not mutate records until explicitly applied.",
    selectedHref: proposal.targetHref ?? proposalHref,
    selectedLabel: proposal.targetLabel,
    tone: "neutral" as const
  };
}

function proposalLifecycleHelp(proposal: CrmChangeProposalView) {
  if (proposal.status === "APPLIED") return "Already applied after review. This card will not create a duplicate proposal.";
  if (proposal.status === "REJECTED") return "Rejected proposals stay visible for audit history and cannot apply changes.";
  if (proposal.status === "FAILED" || proposal.status === "SUPERSEDED") return proposal.conflictInfo?.message ?? "Open the proposal to inspect stale records, conflicts, or duplicate risks.";
  if (proposal.permissionState === "blocked") return proposal.permissionReason;
  return "A matching proposal already exists. Open it to review, edit supported values, apply, or reject.";
}

function selectedRecordLabel(draft: AssistantDraftAction) {
  if (draft.targetHref && draft.targetLabel) return draft.targetLabel;
  const selectedField = draft.fields.find((field) => /^(Organization|Link contact)$/i.test(field.label));
  return selectedField?.value;
}

function hasStaleCandidateWarning(draft: AssistantDraftAction) {
  return [...draft.missingInfo, ...draft.warnings].some((note) => /no longer available|unavailable|deleted/i.test(note));
}

function isBlockedCrmClarificationDraft(draft: AssistantDraftAction) {
  return isCrmProposalDraftKind(draft.kind) && (draft.confidence === "needs_clarification" || Boolean(draft.clarification?.status === "needs_selection"));
}

function isCrmProposalDraftKind(kind: AssistantDraftAction["kind"]) {
  return kind === "contact_create" ||
    kind === "contact_organization_link" ||
    kind === "contact_update" ||
    kind === "organization_create" ||
    kind === "organization_update";
}
