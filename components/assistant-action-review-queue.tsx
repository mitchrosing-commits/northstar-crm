import Link from "next/link";
import type { Route } from "next";

import { applyAssistantActionRequestAction, rejectAssistantActionRequestAction } from "@/app/assistant/actions";
import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantActionRequestView } from "@/lib/services/assistant/assistant-action-request-service";

type AssistantActionReviewQueueProps = {
  requests: AssistantActionRequestView[];
  status: string;
};

export function AssistantActionReviewQueue({ requests, status }: AssistantActionReviewQueueProps) {
  const pendingCount = requests.filter((request) => request.status === "PENDING").length;
  return (
    <section className="data-card assistant-review-queue" id="assistant-review-queue" aria-labelledby="assistant-review-queue-title">
      <PanelTitleRow
        actions={<Badge>{pendingCount} pending</Badge>}
        description="Saved Assistant drafts wait here for review. Apply is available only for low-risk activity or note drafts after you explicitly confirm them."
        eyebrow="Assistant action requests"
        title="Review queue"
        titleId="assistant-review-queue-title"
      />
      {statusMessage(status) ? <p className="compact-success">{statusMessage(status)}</p> : null}
      {requests.length > 0 ? (
        <div className="assistant-review-request-list">
          {requests.map((request) => (
            <article className="assistant-review-request" key={request.id}>
              <header className="assistant-review-request-header">
                <div>
                  <span className="assistant-draft-eyebrow">{request.objectType}</span>
                  <h3>{request.title}</h3>
                </div>
                <span className="assistant-draft-badges">
                  <Badge>{request.status}</Badge>
                  <Badge>{request.riskLevel} risk</Badge>
                </span>
              </header>
              <dl className="assistant-draft-meta">
                <div>
                  <dt>Target</dt>
                  <dd>
                    {request.targetHref ? (
                      <Link className="inline-link" href={request.targetHref as Route}>
                        {request.targetLabel}
                      </Link>
                    ) : (
                      request.targetLabel
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{request.confidence}</dd>
                </div>
                <div>
                  <dt>Apply</dt>
                  <dd>{request.canApply ? `Review-first ${applyNoun(request)} creation` : applyLabel(request)}</dd>
                </div>
              </dl>
              {request.proposedFields.length > 0 ? (
                <div className="assistant-draft-field-list" aria-label={`${request.title} proposed fields`}>
                  {request.proposedFields.map((field) => (
                    <div className="assistant-draft-field" key={`${request.id}-${field.label}`}>
                      <span>{field.label}</span>
                      <strong>{field.value}</strong>
                      {field.currentValue ? <small>Current: {field.currentValue}</small> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {request.warnings.length > 0 || request.missingInfo.length > 0 ? (
                <div className="assistant-draft-section assistant-draft-review-notes" aria-label={`${request.title} review notes`}>
                  <strong>Review notes</strong>
                  <ul>
                    {[...request.missingInfo, ...request.warnings].map((note) => (
                      <li key={`${request.id}-${note}`}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {request.status === "PENDING" ? (
                <div className="assistant-review-request-actions">
                  {request.canApply ? (
                    <form action={applyAssistantActionRequestAction}>
                      <input name="requestId" type="hidden" value={request.id} />
                      <button className="button-primary" type="submit">
                        Apply {applyNoun(request)}
                      </button>
                    </form>
                  ) : (
                    <small>Apply not available yet.</small>
                  )}
                  <form action={rejectAssistantActionRequestAction}>
                    <input name="requestId" type="hidden" value={request.id} />
                    <button className="button-secondary" type="submit">
                      Reject request
                    </button>
                  </form>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="assistant-answer-summary">
          No Assistant action requests. Save a draft action when it is worth reviewing later.
        </p>
      )}
    </section>
  );
}

function statusMessage(status: string) {
  if (status === "saved") return "Draft saved to the pending review queue.";
  if (status === "applied") return "Assistant request applied after review.";
  if (status === "rejected") return "Pending Assistant request rejected.";
  if (status === "error") return "Assistant could not save that draft request.";
  if (status === "apply-error") return "Assistant could not apply that request. Review the target and try again.";
  if (status === "reject-error") return "Assistant could not reject that request.";
  return "";
}

function applyNoun(request: AssistantActionRequestView) {
  return request.actionType === "note" ? "note" : "activity";
}

function applyLabel(request: AssistantActionRequestView) {
  if (request.status === "APPLIED") return "Applied";
  if (request.status === "REJECTED") return "Rejected";
  return "Apply not available yet";
}
