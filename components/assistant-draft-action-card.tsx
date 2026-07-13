import Link from "next/link";
import type { Route } from "next";

import { saveAssistantDraftActionRequest } from "@/app/assistant/actions";
import { Badge } from "@/components/badge";
import type { AssistantDraftAction } from "@/lib/services/assistant/assistant-draft-action-service";

export function AssistantDraftActionCard({ draft, sourceCommand }: { draft: AssistantDraftAction; sourceCommand: string }) {
  return (
    <article className="assistant-draft-card" aria-label={`${draft.title}: ${draft.reviewLabel}`}>
      <header className="assistant-draft-card-header">
        <div>
          <span className="assistant-draft-eyebrow">{draft.targetKind}</span>
          <h3>{draft.title}</h3>
        </div>
        <div className="assistant-draft-badges" aria-label="Draft action status">
          <Badge>{draft.reviewLabel}</Badge>
          <Badge>Review required</Badge>
        </div>
      </header>

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

      <form action={saveAssistantDraftActionRequest} className="assistant-draft-actions">
        <input name="draftAction" type="hidden" value={JSON.stringify(draft)} />
        <input name="sourceCommand" type="hidden" value={sourceCommand} />
        <input name="returnCommand" type="hidden" value={sourceCommand} />
        <button className="button-secondary" type="submit">
          Save to review queue
        </button>
        <small>{draftApplyHelp(draft)}</small>
      </form>
    </article>
  );
}

function confidenceLabel(confidence: AssistantDraftAction["confidence"]) {
  if (confidence === "needs_clarification") return "Needs clarification";
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

function draftApplyLabel(draft: AssistantDraftAction) {
  if (isPotentiallyApplyableDraft(draft)) return "Save, then review";
  if (draft.kind === "activity" || draft.kind === "note") return "Needs clearer target";
  return "Review-only for now";
}

function draftApplyHelp(draft: AssistantDraftAction) {
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
