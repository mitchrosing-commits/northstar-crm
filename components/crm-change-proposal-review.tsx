import Link from "next/link";
import type { Route } from "next";

import { applyCrmChangeProposalAction, rejectCrmChangeProposalAction } from "@/app/crm-change-proposals/actions";
import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { CrmChangeProposalView } from "@/lib/services/crm-change-proposal-service";

type CrmChangeProposalReviewProps = {
  proposal: CrmChangeProposalView;
  status?: string;
};

export function CrmChangeProposalReview({ proposal, status }: CrmChangeProposalReviewProps) {
  return (
    <div className="section-separated">
      {statusMessage(status) ? <p className={status?.includes("error") ? "compact-error" : "compact-success"}>{statusMessage(status)}</p> : null}

      <section className="panel section-separated">
        <PanelTitleRow
          actions={
            <span className="assistant-draft-badges">
              <Badge>{proposal.status}</Badge>
              <Badge>{proposal.permissionLevel}</Badge>
            </span>
          }
          description={proposal.rationale ?? "Review the proposed CRM change before applying it."}
          eyebrow={proposal.sourceLabel ?? proposal.sourceType}
          title={proposal.title}
        />
        <dl className="record-summary-grid" aria-label="CRM change proposal summary">
          <div>
            <dt>Source</dt>
            <dd>{proposal.sourceLabel ?? proposal.sourceType}{proposal.sourceId ? ` (${proposal.sourceId})` : ""}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{proposal.targetHref ? <Link className="inline-link" href={proposal.targetHref as Route}>{proposal.targetLabel}</Link> : proposal.targetLabel}</dd>
          </div>
          {proposal.appliedHref ? (
            <div>
              <dt>Applied record</dt>
              <dd><Link className="inline-link" href={proposal.appliedHref as Route}>{proposal.appliedLabel ?? "Applied CRM record"}</Link></dd>
            </div>
          ) : null}
          <div>
            <dt>Confidence</dt>
            <dd>{proposal.confidence ?? "Not supplied"}</dd>
          </div>
          <div>
            <dt>Permission</dt>
            <dd>{proposal.permissionLabel}</dd>
          </div>
        </dl>
        <p className="assistant-apply-explanation">{proposal.permissionReason}</p>
        {proposal.permissionChecks.length > 1 ? (
          <ul className="compact-list" aria-label="Included CRM action permissions">
            {proposal.permissionChecks.map((check) => (
              <li key={check.label}>
                <strong>{check.label}</strong>
                <span className="table-secondary-text">{check.level}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {proposal.conflictInfo ? (
        <section className="panel section-separated">
          <PanelTitleRow description={proposal.conflictInfo.message} title="Conflict" />
          {proposal.conflictInfo.candidates && proposal.conflictInfo.candidates.length > 0 ? (
            <ul className="compact-list">
              {proposal.conflictInfo.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link className="inline-link" href={candidate.href as Route}>{candidate.label}</Link>
                  <span className="table-secondary-text">{candidate.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {proposal.warnings.length > 0 || proposal.duplicateCandidates.length > 0 ? (
        <section className="panel section-separated">
          <PanelTitleRow title="Review Notes" />
          <ul className="compact-list">
            {proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            {proposal.duplicateCandidates.map((candidate) => (
              <li key={candidate.id}>
                <Link className="inline-link" href={candidate.href as Route}>{candidate.label}</Link>
                <span className="table-secondary-text">{candidate.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <PanelTitleRow
          description="Current values are compared with editable proposed values. Empty edited values are rejected server-side."
          title="Current vs Proposed"
        />
        <form action={applyCrmChangeProposalAction} className="form-stack">
          <input name="proposalId" type="hidden" value={proposal.id} />
          <div className="meeting-review-group">
            {proposal.changeGroups.map((group) => (
              <div className="data-card meeting-review-item" key={group.key}>
                <div className="meeting-review-item-header">
                  <h3>{group.title}</h3>
                  <Badge>{group.fields.length} field{group.fields.length === 1 ? "" : "s"}</Badge>
                </div>
                {group.description ? <p className="table-secondary-text">{group.description}</p> : null}
                {group.targetHref ? (
                  <p><Link className="inline-link" href={group.targetHref as Route}>{group.targetLabel}</Link></p>
                ) : null}
                {group.fields.map((field) => (
                  <div className="relationship-brief-diff-grid" key={`${group.key}-${field.key}`}>
                    <div className="relationship-brief-diff-column">
                      <strong>{field.label} current</strong>
                      <p className="relationship-brief-preview-text">{field.currentValue || "No value"}</p>
                    </div>
                    {field.inputName ? (
                      <label className="form-field relationship-brief-diff-column">
                        <span>{field.label} proposed</span>
                        {field.proposedValue.length > 120 ? (
                          <textarea defaultValue={field.proposedValue} name={field.inputName} rows={4} />
                        ) : (
                          <input defaultValue={field.proposedValue} name={field.inputName} />
                        )}
                      </label>
                    ) : (
                      <div className="relationship-brief-diff-column">
                        <strong>{field.label} proposed</strong>
                        <p className="relationship-brief-preview-text">{field.proposedValue || "No value"}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {proposal.status === "PENDING" ? (
            <div className="filter-actions">
              {proposal.canApply ? (
                <button className="button-primary" type="submit">
                  Apply reviewed change
                </button>
              ) : (
                <span className="table-secondary-text">Apply unavailable: {proposal.permissionReason}</span>
              )}
            </div>
          ) : null}
        </form>
        {proposal.status === "PENDING" ? (
          <form action={rejectCrmChangeProposalAction} className="section-separated">
            <input name="proposalId" type="hidden" value={proposal.id} />
            <button className="button-secondary" type="submit">
              Reject proposal
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function statusMessage(status: string | undefined) {
  if (status === "applied") return "CRM change proposal applied after review.";
  if (status === "rejected") return "CRM change proposal rejected.";
  if (status === "apply-error") return "CRM change proposal could not be applied. Review conflicts, duplicates, or permissions.";
  if (status === "reject-error") return "CRM change proposal could not be rejected.";
  return "";
}
