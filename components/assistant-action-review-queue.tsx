import Link from "next/link";
import type { Route } from "next";

import { applyAssistantActionRequestAction, rejectAssistantActionRequestAction } from "@/app/assistant/actions";
import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantActionRequestView } from "@/lib/services/assistant/assistant-action-request-service";

type AssistantActionReviewQueueProps = {
  queue: AssistantReviewQueueFilter;
  requests: AssistantActionRequestView[];
  status: string;
};

type AssistantReviewQueueFilter = "all" | "applied" | "pending" | "rejected";

export function AssistantActionReviewQueue({ queue, requests, status }: AssistantActionReviewQueueProps) {
  const pendingCount = requests.filter((request) => request.status === "PENDING").length;
  const appliedCount = requests.filter((request) => request.status === "APPLIED").length;
  const rejectedCount = requests.filter((request) => request.status === "REJECTED").length;
  const visibleRequests = requests.filter((request) => requestMatchesQueue(request, queue));
  return (
    <section className="data-card assistant-review-queue" id="assistant-review-queue" aria-labelledby="assistant-review-queue-title">
      <PanelTitleRow
        actions={<Badge>{pendingCount} pending</Badge>}
        description="Saved Assistant drafts wait here for review. Filters hide completed requests from view without deleting audit history or CRM records."
        eyebrow="Assistant action requests"
        title="Review queue"
        titleId="assistant-review-queue-title"
      />
      {statusMessage(status) ? <p className="compact-success">{statusMessage(status)}</p> : null}
      <nav aria-label="Assistant review queue filters" className="assistant-review-queue-tabs">
        {queueTabs({ appliedCount, pendingCount, rejectedCount, totalCount: requests.length }).map((tab) => (
          <Link
            aria-current={queue === tab.id ? "page" : undefined}
            className={queue === tab.id ? "button-primary button-compact" : "button-secondary button-compact"}
            href={tab.href}
            key={tab.id}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {queue !== "pending" ? (
        <p className="assistant-review-cleanup-note">
          Cleanup is view-only in this slice. Use Pending to hide applied and rejected requests without deleting review history.
          {" "}
          <Link className="inline-link" href={"/assistant?queue=pending#assistant-review-queue" as Route}>
            Hide completed requests
          </Link>
        </p>
      ) : null}
      {visibleRequests.length > 0 ? (
        <div className="assistant-review-request-list">
          {visibleRequests.map((request) => (
            <article className={`assistant-review-request assistant-review-request-${request.status.toLowerCase()}`} key={request.id}>
              <header className="assistant-review-request-header">
                <div>
                  <span className="assistant-draft-eyebrow">{actionTypeLabel(request)}</span>
                  <h3>{request.title}</h3>
                </div>
                <span className="assistant-draft-badges">
                  <Badge>{request.status}</Badge>
                  <Badge>{request.riskLevel} risk</Badge>
                </span>
              </header>
              <dl className="assistant-draft-meta">
                <div>
                  <dt>Created</dt>
                  <dd>{formatRequestDateTime(request.createdAt)}</dd>
                </div>
                <div>
                  <dt>Action type</dt>
                  <dd>{actionTypeLabel(request)}</dd>
                </div>
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
                  <dt>Apply availability</dt>
                  <dd>{request.applyAvailability}</dd>
                </div>
              </dl>
              <p className="assistant-apply-explanation">{applyExplanation(request)}</p>
              {request.proposedFields.length > 0 ? (
                <div className="assistant-draft-field-list" aria-label={`${request.title} proposed fields`}>
                  {request.proposedFields.map((field) => (
                    <div className="assistant-draft-field" key={`${request.id}-${field.label}`}>
                      <span>{field.label}</span>
                      {request.status === "PENDING" && request.canApply ? (
                        <input
                          aria-label={`${field.label} reviewed value`}
                          defaultValue={field.value}
                          form={applyFormId(request)}
                          name={`field:${field.label}`}
                        />
                      ) : (
                        <strong>{field.value}</strong>
                      )}
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
                    <form action={applyAssistantActionRequestAction} id={applyFormId(request)}>
                      <input name="requestId" type="hidden" value={request.id} />
                      <button className="button-primary" type="submit">
                        Apply {applyNoun(request)}
                      </button>
                    </form>
                  ) : (
                    <small>{applyLabel(request)}</small>
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
        <p className="assistant-answer-summary">{emptyQueueMessage(queue)}</p>
      )}
    </section>
  );
}

function requestMatchesQueue(request: AssistantActionRequestView, queue: AssistantReviewQueueFilter) {
  if (queue === "all") return true;
  return request.status === queue.toUpperCase();
}

function queueTabs({
  appliedCount,
  pendingCount,
  rejectedCount,
  totalCount
}: {
  appliedCount: number;
  pendingCount: number;
  rejectedCount: number;
  totalCount: number;
}) {
  return [
    { href: "/assistant?queue=pending#assistant-review-queue" as Route, id: "pending" as const, label: `Pending (${pendingCount})` },
    { href: "/assistant?queue=applied#assistant-review-queue" as Route, id: "applied" as const, label: `Applied (${appliedCount})` },
    { href: "/assistant?queue=rejected#assistant-review-queue" as Route, id: "rejected" as const, label: `Rejected (${rejectedCount})` },
    { href: "/assistant?queue=all#assistant-review-queue" as Route, id: "all" as const, label: `All (${totalCount})` }
  ];
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
  if (request.actionType === "note") return "note";
  if (request.actionType === "activity") return "activity";
  if (request.actionType === "contact_create") return "contact";
  if (request.actionType === "contact_update") return "contact update";
  if (request.actionType === "contact_organization_link") return "contact link";
  if (request.actionType === "organization_create") return "organization";
  if (request.actionType === "organization_update") return "organization update";
  return "request";
}

function actionTypeLabel(request: AssistantActionRequestView) {
  if (request.actionType === "activity") return "Activity";
  if (request.actionType === "note") return "Note";
  if (request.actionType === "contact_create") return "Contact creation";
  if (request.actionType === "contact_update") return "Contact update";
  if (request.actionType === "contact_organization_link") return "Contact organization link";
  if (request.actionType === "organization_create") return "Organization creation";
  if (request.actionType === "organization_update") return "Organization update";
  return "Review-only";
}

function applyLabel(request: AssistantActionRequestView) {
  if (request.status === "APPLIED") return "Applied";
  if (request.status === "REJECTED") return "Rejected";
  if (request.permissionState === "blocked" && request.permissionLevel === "require_confirmation") return "Blocked pending review";
  if (request.permissionState === "blocked") return `Blocked by AI Preferences: ${request.permissionLevel}`;
  if (request.actionType === "activity" || request.actionType === "note") return "Blocked pending review";
  return "Apply not available yet";
}

function applyExplanation(request: AssistantActionRequestView) {
  if (request.status === "APPLIED") return "This request has already been applied and cannot be applied again.";
  if (request.status === "REJECTED") return "This request was rejected and cannot be applied.";
  if (request.canApply && request.permissionState === "allowed_automatically") {
    return `New eligible ${applyNoun(request)} requests can apply automatically under your current AI Preferences. This saved request still requires a current server-side eligibility check.`;
  }
  if (request.canApply) return `Apply will perform this ${applyNoun(request)} after this explicit review step because your AI Preferences require confirmation.`;
  if (request.permissionReason) return request.permissionReason;
  if (request.actionType === "activity" || request.actionType === "note") {
    if (request.missingInfo.length > 0) return "Apply is blocked until the missing information is resolved.";
    if (!request.targetHref || request.confidence === "needs_clarification") return "Apply is blocked until one clear target record is selected.";
    if (request.riskLevel !== "low" || request.confidence !== "high") return "Apply is blocked until this draft is low-risk and high-confidence.";
    return "Apply is blocked until this draft is eligible for activity or note creation.";
  }
  if (request.actionType === "contact_relationship_update") {
    return "Relationship Memory updates are review-only for now and must be handled outside Assistant apply.";
  }
  if (request.actionType === "ai_preference_update") {
    return "AI preference changes are review-only for now and must be changed in settings.";
  }
  if (request.actionType === "organization_contact_creation") {
    return "Contact and organization creation is review-only for now.";
  }
  return "Apply is currently limited to eligible activity, note, contact, and organization requests.";
}

function applyFormId(request: AssistantActionRequestView) {
  return `assistant-apply-${request.id}`;
}

function emptyQueueMessage(queue: AssistantReviewQueueFilter) {
  if (queue === "pending") {
    return "No pending Assistant action requests. Ask for a draft action, review the preview, then save it to this queue when it is worth applying later.";
  }
  if (queue === "applied") {
    return "No applied Assistant action requests yet. Completed review-first activity and note applies will appear here after you explicitly confirm them.";
  }
  if (queue === "rejected") {
    return "No rejected Assistant action requests yet. Requests you reject during review will appear here without deleting audit history.";
  }
  return "No Assistant action requests yet. The review-first workflow starts with a draft, then lets you save, apply eligible activity or note requests, or reject them.";
}

function formatRequestDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric"
  }).format(new Date(value));
}
