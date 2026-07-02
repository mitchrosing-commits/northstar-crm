"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { CompactList, CompactListItem } from "@/components/compact-list";
import { CompactTitleRow } from "@/components/compact-title-row";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { PanelTitleRow } from "@/components/panel-title-row";
import type {
  ApplyMeetingIntelligenceResult,
  CrmTarget,
  MatchedCrmObject,
  MeetingIntelligenceDraft
} from "@/lib/meeting-intelligence/types";

type Option = { id: string; label: string };

type MeetingIntelligenceReviewProps = {
  applyResult?: ApplyMeetingIntelligenceResult | null;
  draft: MeetingIntelligenceDraft;
  intakeId: string;
  options: {
    deals: Option[];
    leads: Option[];
    organizations: Option[];
    people: Option[];
    users: Option[];
  };
  status: string;
  workspaceId: string;
};

export function MeetingIntelligenceReview({
  applyResult,
  draft,
  intakeId,
  options,
  status,
  workspaceId
}: MeetingIntelligenceReviewProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const targetOptions = useMemo(() => buildTargetOptions(options), [options]);
  const isApplied = status === "APPLIED";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    const formData = new FormData(event.currentTarget);
    const payload = {
      meetingActivity: draft.meetingActivity
        ? {
            completedAt: String(formData.get("meeting.completedAt") ?? ""),
            description: String(formData.get("meeting.description") ?? ""),
            include: formData.has("meeting.include"),
            target: parseTarget(String(formData.get("meeting.target") ?? "")),
            title: String(formData.get("meeting.title") ?? "")
          }
        : null,
      nextStepActivities: draft.nextStepActivities.map((_activity, index) => ({
        description: String(formData.get(`next.${index}.description`) ?? ""),
        dueAt: dateToIso(String(formData.get(`next.${index}.dueAt`) ?? "")),
        include: formData.has(`next.${index}.include`),
        ownerId: String(formData.get(`next.${index}.ownerId`) ?? ""),
        target: parseTarget(String(formData.get(`next.${index}.target`) ?? "")),
        title: String(formData.get(`next.${index}.title`) ?? ""),
        type: String(formData.get(`next.${index}.type`) ?? "TASK")
      })),
      notes: draft.notes.map((_note, index) => ({
        body: String(formData.get(`note.${index}.body`) ?? ""),
        include: formData.has(`note.${index}.include`),
        target: parseTarget(String(formData.get(`note.${index}.target`) ?? ""))
      }))
    };

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/meeting-intakes/${intakeId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not apply the meeting intake.");
      setIsSaving(false);
      return;
    }
    router.refresh();
    setIsSaving(false);
  }

  if (isApplied && applyResult) {
    return <ApplyResult result={applyResult} />;
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

      <section className="panel" aria-labelledby="meeting-proposal-heading">
        <PanelTitleRow title="Meeting Log" titleId="meeting-proposal-heading" />
        {draft.meetingActivity ? (
          <div className="inline-form">
            <div className="form-grid">
              <label className="form-field checkbox-field form-field-wide">
                <input defaultChecked={draft.meetingActivity.include} name="meeting.include" type="checkbox" />
                <span>Create completed meeting activity</span>
              </label>
              <label className="form-field">
                <FormFieldLabel required>Title</FormFieldLabel>
                <input name="meeting.title" defaultValue={draft.meetingActivity.title} required />
              </label>
            <label className="form-field">
              <FormFieldLabel>Target</FormFieldLabel>
              <TargetSelect defaultTarget={draft.meetingActivity.target} name="meeting.target" options={targetOptions} />
            </label>
              <label className="form-field">
                <FormFieldLabel>Completed date</FormFieldLabel>
                <input name="meeting.completedAt" type="date" defaultValue={isoToDateValue(draft.meetingActivity.completedAt)} />
              </label>
              <label className="form-field form-field-wide">
                <FormFieldLabel>Description</FormFieldLabel>
                <textarea name="meeting.description" rows={8} defaultValue={draft.meetingActivity.description} />
              </label>
            </div>
            <ProposalEvidence
              confidence={draft.meetingActivity.confidence}
              evidence={draft.meetingActivity.evidence}
              matchedReason={draft.meetingActivity.matchedReason}
              targetWarning={draft.meetingActivity.targetWarning}
            />
          </div>
        ) : (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            description="A completed meeting activity will appear when the intake has a matched or selected CRM target."
            title="No meeting activity proposed"
          />
        )}
      </section>

      <section className="panel" aria-labelledby="matches-heading">
        <PanelTitleRow title="Matches and Warnings" titleId="matches-heading" />
        <CompactList>
          {draft.sourceMetadata ? (
            <CompactListItem>
              <strong>Source metadata</strong>
              <span className="muted">
                {[
                  draft.sourceMetadata.filename,
                  draft.sourceMetadata.mimeType,
                  draft.sourceMetadata.pageCount ? `${draft.sourceMetadata.pageCount} pages` : null,
                  draft.sourceMetadata.wordCount ? `${draft.sourceMetadata.wordCount} words` : null,
                  `processor: ${draft.sourceMetadata.processor}`
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </CompactListItem>
          ) : null}
          {matchGroups(draft.matchedObjects).map((group) => (
            <CompactListItem key={group.label}>
              <strong>{group.label}</strong>
              <CompactList>
                {group.matches.map((match) => (
                  <CompactListItem key={`${match.objectType}-${match.id}`}>
                    <strong>{match.displayName}</strong>
                    <span className="muted">
                      {match.confidence} · {match.matchedReason}
                    </span>
                    <span className="muted">{match.evidenceExcerpt}</span>
                    {match.warning ? <span className="badge">{match.warning}</span> : null}
                  </CompactListItem>
                ))}
              </CompactList>
            </CompactListItem>
          ))}
          {draft.warnings.map((warning) => (
            <CompactListItem key={warning}>
              <span className="badge">{warning}</span>
            </CompactListItem>
          ))}
          {draft.unmatchedEntities.length > 0 ? (
            <CompactListItem>
              <strong>Unmatched mentions</strong>
              <CompactList>
                {draft.unmatchedEntities.map((entity) => (
                  <CompactListItem key={`${entity.entityType}-${entity.name}`}>
                    <strong>{entity.name}</strong>
                    <span className="muted">{entity.reason}</span>
                    <span className="muted">{entity.evidenceExcerpt}</span>
                  </CompactListItem>
                ))}
              </CompactList>
            </CompactListItem>
          ) : null}
        </CompactList>
      </section>

      <section className="panel" aria-labelledby="notes-heading">
        <PanelTitleRow title="Proposed Notes" titleId="notes-heading" />
        <div className="inline-form">
          {draft.notes.length > 0 ? (
            draft.notes.map((note, index) => (
              <div className="data-card meeting-review-item" key={note.id}>
                <label className="form-field checkbox-field">
                  <input defaultChecked={note.include} name={`note.${index}.include`} type="checkbox" />
                  <span>Apply note</span>
                </label>
                <div className="form-grid">
                  <label className="form-field">
                    <FormFieldLabel>Target</FormFieldLabel>
                    <TargetSelect defaultTarget={note.target} name={`note.${index}.target`} options={targetOptions} />
                  </label>
                  <label className="form-field form-field-wide">
                    <FormFieldLabel required>Body</FormFieldLabel>
                    <textarea name={`note.${index}.body`} rows={6} defaultValue={note.body} required />
                  </label>
                </div>
                <ProposalEvidence
                  confidence={note.confidence}
                  evidence={note.evidence}
                  matchedReason={note.matchedReason}
                  targetWarning={note.targetWarning}
                />
              </div>
            ))
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="Meeting notes will appear here when the intake contains useful CRM timeline context."
              title="No notes proposed"
            />
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="next-steps-heading">
        <PanelTitleRow title="Follow-Ups" titleId="next-steps-heading" />
        <div className="inline-form">
          {draft.nextStepActivities.length > 0 ? (
            draft.nextStepActivities.map((activity, index) => (
              <div className="data-card meeting-review-item" key={activity.id}>
                <label className="form-field checkbox-field">
                  <input defaultChecked={activity.include} name={`next.${index}.include`} type="checkbox" />
                  <span>Create follow-up</span>
                </label>
                <div className="form-grid">
                  <label className="form-field form-field-wide">
                    <FormFieldLabel required>Title</FormFieldLabel>
                    <input name={`next.${index}.title`} defaultValue={activity.title} required />
                  </label>
                  <label className="form-field">
                    <FormFieldLabel>Type</FormFieldLabel>
                    <select name={`next.${index}.type`} defaultValue={activity.type}>
                      <option value="TASK">Task</option>
                      <option value="CALL">Call</option>
                      <option value="EMAIL">Email</option>
                      <option value="MEETING">Meeting</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <FormFieldLabel>Due date</FormFieldLabel>
                    <input name={`next.${index}.dueAt`} type="date" defaultValue={isoToDateValue(activity.dueAt)} />
                  </label>
                  <label className="form-field">
                    <FormFieldLabel>Owner</FormFieldLabel>
                    <select name={`next.${index}.ownerId`} defaultValue={activity.ownerId ?? ""}>
                      <option value="">Unassigned</option>
                      {options.users.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <FormFieldLabel>Target</FormFieldLabel>
                    <TargetSelect defaultTarget={activity.target} name={`next.${index}.target`} options={targetOptions} />
                  </label>
                  <label className="form-field form-field-wide">
                    <FormFieldLabel>Description</FormFieldLabel>
                    <textarea name={`next.${index}.description`} rows={3} defaultValue={activity.description ?? ""} />
                  </label>
                </div>
                <ProposalEvidence
                  confidence={activity.confidence}
                  evidence={activity.evidence}
                  matchedReason={activity.matchedReason}
                  targetWarning={activity.targetWarning}
                />
              </div>
            ))
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="Follow-ups will appear here when the intake contains a clear next action."
              title="No follow-ups proposed"
            />
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="markdown-preview-heading">
        <PanelTitleRow title="Normalized Markdown" titleId="markdown-preview-heading" />
        <pre className="meeting-markdown-preview">{draft.markdown}</pre>
      </section>

      <section className="panel" aria-labelledby="apply-summary-heading">
        <PanelTitleRow title="Apply Summary" titleId="apply-summary-heading" />
        <CompactList>
          <CompactListItem>
            <strong>Default selected updates</strong>
            <span className="muted">{defaultApplySummary(draft)}</span>
          </CompactListItem>
          {draft.notes.some((note) => !note.target) || draft.nextStepActivities.some((activity) => !activity.target) ? (
            <CompactListItem>
              <span className="badge">Untargeted selected updates will be skipped.</span>
            </CompactListItem>
          ) : null}
        </CompactList>
      </section>

      <FormActionBar
        cancelHref={"/meeting-intelligence" as Route}
        cancelLabel="Back"
        isSaving={isSaving}
        pendingLabel="Applying..."
        submitLabel="Apply selected updates"
      />
    </form>
  );
}

function TargetSelect({ defaultTarget, name, options }: { defaultTarget: CrmTarget | null; name: string; options: TargetOption[] }) {
  return (
    <select name={name} defaultValue={defaultTarget ? targetValue(defaultTarget) : ""}>
      <option value="">No target</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type TargetOption = { label: string; value: string };

function buildTargetOptions(options: MeetingIntelligenceReviewProps["options"]): TargetOption[] {
  return [
    ...options.deals.map((option) => ({ label: `Deal: ${option.label}`, value: `deal:${option.id}` })),
    ...options.leads.map((option) => ({ label: `Lead: ${option.label}`, value: `lead:${option.id}` })),
    ...options.organizations.map((option) => ({ label: `Organization: ${option.label}`, value: `organization:${option.id}` })),
    ...options.people.map((option) => ({ label: `Contact: ${option.label}`, value: `person:${option.id}` }))
  ];
}

function parseTarget(value: string): CrmTarget | null {
  const [type, id] = value.split(":");
  if (!id) return null;
  if (type === "deal" || type === "lead" || type === "person" || type === "organization") return { id, type };
  return null;
}

function targetValue(target: CrmTarget) {
  return `${target.type}:${target.id}`;
}

function isoToDateValue(value: string | undefined) {
  return value ? value.slice(0, 10) : "";
}

function dateToIso(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : "";
}

function matchGroups(matches: MatchedCrmObject[]) {
  const groups = [
    { label: "Deals", matches: matches.filter((match) => match.objectType === "deal" && match.confidence !== "ambiguous") },
    { label: "Leads", matches: matches.filter((match) => match.objectType === "lead" && match.confidence !== "ambiguous") },
    { label: "Organizations", matches: matches.filter((match) => match.objectType === "organization" && match.confidence !== "ambiguous") },
    { label: "Contacts", matches: matches.filter((match) => match.objectType === "person" && match.confidence !== "ambiguous") },
    { label: "Ambiguous matches", matches: matches.filter((match) => match.confidence === "ambiguous") }
  ];
  return groups.filter((group) => group.matches.length > 0);
}

function ProposalEvidence({
  confidence,
  evidence,
  matchedReason,
  targetWarning
}: {
  confidence?: string;
  evidence: string[];
  matchedReason?: string;
  targetWarning?: string;
}) {
  const items = evidence.filter(Boolean).slice(0, 3);
  if (!confidence && !matchedReason && !targetWarning && items.length === 0) return null;
  return (
    <CompactList>
      <CompactListItem>
        {confidence || matchedReason ? (
          <span className="muted">{[confidence ? `Confidence: ${confidence}` : "", matchedReason].filter(Boolean).join(" · ")}</span>
        ) : null}
        {targetWarning ? <span className="badge">{targetWarning}</span> : null}
        {items.map((item) => (
          <span className="muted" key={item}>
            Evidence: {item}
          </span>
        ))}
      </CompactListItem>
    </CompactList>
  );
}

function defaultApplySummary(draft: MeetingIntelligenceDraft) {
  const meeting = draft.meetingActivity?.include ? 1 : 0;
  const notes = draft.notes.filter((note) => note.include).length;
  const followUps = draft.nextStepActivities.filter((activity) => activity.include).length;
  return [`${meeting} meeting log`, `${notes} notes`, `${followUps} follow-ups`].join(" · ");
}

function ApplyResult({ result }: { result: ApplyMeetingIntelligenceResult }) {
  const createAnotherActionsLabel = "Applied meeting intake actions";
  const createAnotherActionLabel = "Create another meeting intelligence intake";

  return (
    <section className="panel" aria-labelledby="applied-updates-heading">
      <PanelTitleRow title="Applied Updates" titleId="applied-updates-heading" />
      {result.created.length > 0 ? (
        <CompactList>
          {result.created.map((created) => (
            <CompactListItem key={`${created.type}-${created.id}`}>
              <strong>{created.type === "activity" ? "Activity" : "Note"} created</strong>
              <Link href={created.href as Route}>{created.label}</Link>
            </CompactListItem>
          ))}
        </CompactList>
      ) : (
        <EmptyState
          className="empty-state-compact empty-state-panel"
          description="The intake was applied, but every proposed update was skipped or unavailable."
          title="No CRM updates created"
        />
      )}
      {result.skipped.length > 0 ? (
        <>
          <CompactTitleRow title="Skipped" />
          <CompactList>
            {result.skipped.map((skipped, index) => (
              <CompactListItem key={`${skipped.type}-${index}`}>
                <strong>{skipped.label}</strong>
                <span className="muted">{skipped.reason}</span>
              </CompactListItem>
            ))}
          </CompactList>
        </>
      ) : null}
      <ActionGroup className="form-actions" label={createAnotherActionsLabel}>
        <Link
          aria-label={createAnotherActionLabel}
          className="button-primary"
          href={"/meeting-intelligence" as Route}
          title={createAnotherActionLabel}
        >
          Create another intake
        </Link>
      </ActionGroup>
    </section>
  );
}
