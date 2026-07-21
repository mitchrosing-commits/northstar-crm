import Link from "next/link";
import type { Route } from "next";

import { applyAssistantActionRequestAction, rejectAssistantActionRequestAction } from "@/app/assistant/actions";
import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantActionRequestView } from "@/lib/services/assistant/assistant-action-request-service";
import type { CrmChangeProposalView } from "@/lib/services/crm-change-proposal-service";

type AssistantActionReviewQueueProps = {
  crmChangeProposals: CrmChangeProposalView[];
  queue: AssistantReviewQueueFilter;
  requests: AssistantActionRequestView[];
  status: string;
};

type AssistantReviewQueueFilter = "all" | "applied" | "pending" | "rejected";

export function AssistantActionReviewQueue({ crmChangeProposals, queue, requests, status }: AssistantActionReviewQueueProps) {
  const pendingCount = requests.filter((request) => request.status === "PENDING").length;
  const appliedCount = requests.filter((request) => request.status === "APPLIED").length;
  const rejectedCount = requests.filter((request) => request.status === "REJECTED").length;
  const visibleRequests = requests.filter((request) => requestMatchesQueue(request, queue));
  const visibleProposals = crmChangeProposals.filter((proposal) => proposalMatchesQueue(proposal, queue));
  const pendingProposalCount = crmChangeProposals.filter((proposal) => proposal.status === "PENDING" || proposal.status === "FAILED" || proposal.status === "SUPERSEDED").length;
  const appliedProposalCount = crmChangeProposals.filter((proposal) => proposal.status === "APPLIED").length;
  const rejectedProposalCount = crmChangeProposals.filter((proposal) => proposal.status === "REJECTED").length;
  return (
    <section className="data-card assistant-review-queue" id="assistant-review-queue" aria-labelledby="assistant-review-queue-title">
      <PanelTitleRow
        actions={
          <>
            <Badge>{pendingCount} pending requests</Badge>
            <Badge>{pendingProposalCount} pending proposals</Badge>
          </>
        }
        description="Saved Assistant drafts and CRM Change Proposals wait here for review. Filters hide completed items from view without deleting audit history or CRM records."
        eyebrow="Assistant action requests"
        title="Review queue"
        titleId="assistant-review-queue-title"
      />
      {statusMessage(status) ? <p className="compact-success">{statusMessage(status)}</p> : null}
      <nav aria-label="Assistant review queue filters" className="assistant-review-queue-tabs">
        {queueTabs({
          appliedCount: appliedCount + appliedProposalCount,
          pendingCount: pendingCount + pendingProposalCount,
          rejectedCount: rejectedCount + rejectedProposalCount,
          totalCount: requests.length + crmChangeProposals.length
        }).map((tab) => (
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
      {visibleRequests.length > 0 || visibleProposals.length > 0 ? (
        <>
          {visibleRequests.length > 0 ? (
            <div className="assistant-review-request-list">
              {visibleRequests.map((request) => {
                const lifecycle = requestLifecycle(request);
                return (
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
              <div className={`assistant-lifecycle-row assistant-lifecycle-row-${lifecycle.tone}`} aria-label={`${request.title} lifecycle status`}>
                <Badge>{lifecycle.label}</Badge>
                <span>
                  {lifecycle.reason}
                  {" "}
                  Next action: {lifecycle.nextAction}.
                </span>
              </div>
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
                );
              })}
            </div>
          ) : null}
          {visibleProposals.length > 0 ? <AssistantCrmProposalOutcomeList proposals={visibleProposals} /> : null}
        </>
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

function proposalMatchesQueue(proposal: CrmChangeProposalView, queue: AssistantReviewQueueFilter) {
  if (queue === "all") return true;
  if (queue === "pending") return proposal.status === "PENDING" || proposal.status === "FAILED" || proposal.status === "SUPERSEDED";
  return proposal.status === queue.toUpperCase();
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

function requestLifecycle(request: AssistantActionRequestView) {
  if (request.status === "APPLIED") {
    return {
      label: "Request applied",
      nextAction: "open the created CRM record from its timeline or dismiss",
      reason: "This Assistant request was applied after review.",
      tone: "success" as const
    };
  }
  if (request.status === "REJECTED") {
    return {
      label: "Request rejected",
      nextAction: "dismiss or draft a fresh request",
      reason: "This request was rejected and cannot apply changes.",
      tone: "neutral" as const
    };
  }
  if (request.permissionState === "blocked") {
    return {
      label: "Permission denied",
      nextAction: "review AI Preferences or reject the request",
      reason: request.permissionReason,
      tone: "danger" as const
    };
  }
  if (request.confidence === "needs_clarification" || request.missingInfo.length > 0) {
    return {
      label: "Awaiting clarification",
      nextAction: "retry safely with a clear target or reject the request",
      reason: request.missingInfo[0] ?? "This request needs a clear target before apply is available.",
      tone: "warning" as const
    };
  }
  return {
    label: "Pending review",
    nextAction: request.canApply ? `apply ${applyNoun(request)} or reject` : "review or reject",
    reason: request.canApply ? "This saved request can apply only after explicit review." : applyExplanation(request),
    tone: "neutral" as const
  };
}

function AssistantCrmProposalOutcomeList({ proposals }: { proposals: CrmChangeProposalView[] }) {
  return (
    <section className="assistant-proposal-outcomes" aria-label="CRM proposal outcomes">
      <div className="assistant-proposal-outcomes-header">
        <span className="assistant-draft-eyebrow">CRM Change Proposals</span>
        <strong>Proposal outcomes</strong>
      </div>
      <div className="assistant-proposal-outcome-list">
        {proposals.map((proposal) => {
          const lifecycle = proposalLifecycle(proposal);
          return (
            <article className={`assistant-proposal-outcome assistant-proposal-outcome-${proposal.status.toLowerCase()}`} key={proposal.id}>
              <header className="assistant-review-request-header">
                <div>
                  <span className="assistant-draft-eyebrow">{proposalTypeLabel(proposal.proposalType)}</span>
                  <h3>{proposal.title}</h3>
                </div>
                <span className="assistant-draft-badges">
                  <Badge>{lifecycle.label}</Badge>
                  <Badge>{proposal.permissionLevel}</Badge>
                </span>
              </header>
              <div className={`assistant-lifecycle-row assistant-lifecycle-row-${lifecycle.tone}`} aria-label={`${proposal.title} lifecycle status`}>
                <Badge>{lifecycle.label}</Badge>
                <span>
                  {lifecycle.reason}
                  {" "}
                  Next action: {lifecycle.nextAction}.
                </span>
              </div>
              <dl className="assistant-draft-meta">
                <div>
                  <dt>Requested action</dt>
                  <dd>{proposal.title}</dd>
                </div>
                <div>
                  <dt>Selected record</dt>
                  <dd>
                    {proposal.targetHref ? (
                      <Link className="inline-link" href={proposal.targetHref as Route}>
                        {proposal.targetLabel}
                      </Link>
                    ) : (
                      proposal.targetLabel
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Proposal</dt>
                  <dd>
                    <Link className="inline-link" href={`/crm-change-proposals/${proposal.id}` as Route}>
                      {proposal.status === "PENDING" ? "Review proposal" : "Open proposal"}
                    </Link>
                  </dd>
                </div>
                {proposal.appliedHref ? (
                  <div>
                    <dt>Applied record</dt>
                    <dd>
                      <Link className="inline-link" href={proposal.appliedHref as Route}>
                        {proposal.appliedLabel ?? "Applied CRM record"}
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function proposalLifecycle(proposal: CrmChangeProposalView) {
  if (proposal.status === "APPLIED") {
    return {
      label: "Proposal applied",
      nextAction: proposal.appliedHref ? "open the applied CRM record" : "open the proposal",
      reason: "This CRM Change Proposal was applied after review.",
      tone: "success" as const
    };
  }
  if (proposal.status === "REJECTED") {
    return {
      label: "Proposal rejected",
      nextAction: "open the proposal or dismiss",
      reason: "This CRM Change Proposal was rejected and will not apply changes.",
      tone: "neutral" as const
    };
  }
  if (proposal.status === "FAILED" || proposal.status === "SUPERSEDED") {
    return {
      label: "Proposal failed or stale",
      nextAction: "open the proposal and retry safely if still needed",
      reason: proposal.conflictInfo?.message ?? proposal.warnings[0] ?? "This proposal could not be applied in its current state.",
      tone: "danger" as const
    };
  }
  if (proposal.permissionState === "blocked") {
    return {
      label: "Permission denied",
      nextAction: "review AI Preferences or open the proposal",
      reason: proposal.permissionReason,
      tone: "danger" as const
    };
  }
  return {
    label: "CRM Change Proposal pending review",
    nextAction: "review proposal",
    reason: "This proposal is saved for review. It will not mutate records until explicitly applied.",
    tone: "neutral" as const
  };
}

function proposalTypeLabel(type: CrmChangeProposalView["proposalType"]) {
  if (type === "CREATE_PERSON") return "Contact creation";
  if (type === "UPDATE_PERSON") return "Contact update";
  if (type === "LINK_PERSON_ORGANIZATION") return "Contact organization link";
  if (type === "CREATE_ORGANIZATION") return "Organization creation";
  if (type === "UPDATE_ORGANIZATION") return "Organization update";
  return "Contact and organization proposal";
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
