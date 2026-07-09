"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type Dispatch, FormEvent, type SetStateAction, useMemo, useRef, useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { Badge } from "@/components/badge";
import { CompactList, CompactListItem } from "@/components/compact-list";
import { CompactTitleRow } from "@/components/compact-title-row";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { PanelTitleRow } from "@/components/panel-title-row";
import type {
  ApplyMeetingIntelligenceResult,
  CrmTarget,
  MatchedCrmObject,
  MeetingIntelligenceDraft,
  MeetingProposalFactCategory,
  MeetingSourceMetadata,
  ProposedNextStepActivity,
  ProposedNote,
  ProposedRelationshipBriefFact,
  RelationshipBriefFields,
  RelationshipBriefSensitivityCategory,
  UnmatchedEntity
} from "@/lib/meeting-intelligence/types";
import {
  explainMeetingActivityPlacement,
  explainMeetingNotePlacement,
  explainRelationshipFactPlacement,
  type MeetingPlacementExplanation
} from "@/lib/meeting-intelligence/placement-explanations";
import { relationshipBriefUsageItems } from "@/lib/relationship-brief-usage";

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
  const relationshipOptions = useMemo(() => relationshipTargetOptions(options), [options]);
  const relationshipBriefUpdates = draft.relationshipBriefUpdates ?? [];
  const [relationshipFactDrafts, setRelationshipFactDrafts] = useState(() =>
    relationshipBriefUpdates.map((update) => relationshipFactsForReview(update))
  );
  const [selectedRelationshipTargets, setSelectedRelationshipTargets] = useState(() =>
    relationshipBriefUpdates.map((update) => update.target)
  );
  const [relationshipBriefTargetStates, setRelationshipBriefTargetStates] = useState(() =>
    relationshipBriefUpdates.map((update) => initialRelationshipBriefTargetState(update))
  );
  const relationshipFactIncludeTouched = useRef<Set<string>>(new Set());
  const isApplied = status === "APPLIED";
  const relationshipBriefPreviewBlocked = relationshipBriefTargetStates.some((state, index) =>
    Boolean(selectedRelationshipTargets[index]) && (state.status === "loading" || state.status === "failed")
  );
  const warningCount = meetingReviewWarningCount(draft);
  const matchedObjectGroups = matchGroups(draft.matchedObjects);
  const hasMatchReviewSignals = Boolean(draft.sourceMetadata) ||
    matchedObjectGroups.length > 0 ||
    draft.warnings.length > 0 ||
    draft.unmatchedEntities.length > 0;
  const proposedUpdateCount =
    (draft.meetingActivity ? 1 : 0) + draft.notes.length + draft.nextStepActivities.length + relationshipBriefUpdates.length;
  const selectedUpdateCount =
    (draft.meetingActivity?.include ? 1 : 0) +
    draft.notes.filter((note) => note.include).length +
    draft.nextStepActivities.filter((activity) => activity.include).length +
    relationshipBriefUpdates.filter((update) => update.include).length;
  const missingTargetCount =
    (draft.meetingActivity && draft.meetingActivity.include && !draft.meetingActivity.target ? 1 : 0) +
    draft.notes.filter((note) => note.include && !note.target).length +
    draft.nextStepActivities.filter((activity) => activity.include && !activity.target).length +
    relationshipBriefUpdates.filter((update) => update.include && !update.target).length;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (relationshipBriefPreviewBlocked) {
      setError("Wait for the selected contact Relationship Memory preview to load before applying updates.");
      return;
    }
    setIsSaving(true);
    const formData = new FormData(event.currentTarget);
    const payload = {
      meetingActivity: draft.meetingActivity
        ? {
            associatedTargets: draft.meetingActivity.associatedTargets?.map((_target, index) => ({
              include: formData.has(`meeting.association.${index}.include`),
              target: parseTarget(String(formData.get(`meeting.association.${index}.target`) ?? ""))
            })),
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
      })),
      relationshipBriefUpdates: relationshipBriefUpdates.map((update, index) => {
        const facts = (relationshipFactDrafts[index] ?? relationshipFactsForReview(update)).map((_fact, factIndex) => ({
          field: String(formData.get(`relationship.${index}.fact.${factIndex}.field`) ?? ""),
          include: formData.has(`relationship.${index}.fact.${factIndex}.include`),
          text: String(formData.get(`relationship.${index}.fact.${factIndex}.text`) ?? "")
        }));
        return {
          facts,
          include: formData.has(`relationship.${index}.include`),
          proposed: relationshipProposedFieldsFromReviewFacts(facts),
          target: parseRelationshipTarget(String(formData.get(`relationship.${index}.target`) ?? ""))
        };
      })
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

  async function loadRelationshipTargetBrief(updateIndex: number, target: CrmTarget | null) {
    if (!target) {
      setRelationshipBriefTargetStates((current) =>
        current.map((state, index) => (index === updateIndex ? { existing: {}, status: "idle", targetId: null } : state))
      );
      setRelationshipFactDrafts((current) =>
        current.map((facts, index) =>
          index === updateIndex ? reconcileRelationshipFactsForExisting(facts, {}, updateIndex, relationshipFactIncludeTouched.current) : facts
        )
      );
      return;
    }

    setRelationshipBriefTargetStates((current) =>
      current.map((state, index) =>
        index === updateIndex
          ? { existing: {}, status: "loading", targetId: target.id, targetLabel: target.label }
          : state
      )
    );

    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/people/${target.id}`, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Could not load selected contact.");
      const body = await response.json();
      const existing = relationshipBriefFieldsFromPersonResponse(body);
      setRelationshipBriefTargetStates((current) =>
        current.map((state, index) =>
          index === updateIndex && state.targetId === target.id
            ? { existing, status: "ready", targetId: target.id, targetLabel: target.label }
            : state
        )
      );
      setRelationshipFactDrafts((current) =>
        current.map((facts, index) =>
          index === updateIndex
            ? reconcileRelationshipFactsForExisting(facts, existing, updateIndex, relationshipFactIncludeTouched.current)
            : facts
        )
      );
    } catch {
      setRelationshipBriefTargetStates((current) =>
        current.map((state, index) =>
          index === updateIndex && state.targetId === target.id
            ? {
                existing: {},
                error: "Could not load the selected contact Relationship Memory. Choose another contact or try again.",
                status: "failed",
                targetId: target.id,
                targetLabel: target.label
              }
            : state
        )
      );
    }
  }

  function onRelationshipTargetChange(updateIndex: number, value: string) {
    const target = relationshipTargetFromSelectValue(value, relationshipOptions);
    setSelectedRelationshipTargets((current) => current.map((candidate, index) => (index === updateIndex ? target : candidate)));
    void loadRelationshipTargetBrief(updateIndex, target);
  }

  function onRelationshipFactChange(
    updateIndex: number,
    factIndex: number,
    changes: Partial<RelationshipFactDraft>,
    options: { includeTouched?: boolean } = {}
  ) {
    const factKey = relationshipFactKey(updateIndex, factIndex);
    if (options.includeTouched) relationshipFactIncludeTouched.current.add(factKey);
    updateRelationshipFact(setRelationshipFactDrafts, updateIndex, factIndex, changes, {
      existing: relationshipBriefTargetStates[updateIndex]?.existing ?? {},
      preserveInclude: relationshipFactIncludeTouched.current.has(factKey)
    });
  }

  if (isApplied && applyResult) {
    return <ApplyResult result={applyResult} />;
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

      <ReviewOrientationSummary
        missingTargetCount={missingTargetCount}
        proposedUpdateCount={proposedUpdateCount}
        selectedUpdateCount={selectedUpdateCount}
        warningCount={warningCount}
      />
      <ProposalCategoryOverview draft={draft} />

      <section className="panel meeting-review-section" aria-labelledby="meeting-proposal-heading">
        <PanelTitleRow
          actions={<Badge>{draft.meetingActivity?.include ? "Selected" : "Review only"}</Badge>}
          description="Edit the completed meeting activity before it becomes CRM timeline history."
          title="Meeting Log"
          titleId="meeting-proposal-heading"
        />
        {draft.meetingActivity ? (
          <div className="inline-form">
            <MeetingSummaryBlock
              associatedTargets={draft.meetingActivity.associatedTargets ?? []}
              summary={draft.summary}
            />
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
            {draft.meetingActivity.associatedTargets && draft.meetingActivity.associatedTargets.length > 0 ? (
              <div className="meeting-review-group">
                <CompactTitleRow
                  actions={<CountBadge className="badge">{draft.meetingActivity.associatedTargets.length} records</CountBadge>}
                  title="Structured Associations"
                />
                <div className="form-grid">
                  {draft.meetingActivity.associatedTargets.map((target, index) => (
                    <div className="data-card meeting-association-item" key={`${target.type}-${target.id}-${index}`}>
                      <label className="form-field checkbox-field">
                        <input defaultChecked name={`meeting.association.${index}.include`} type="checkbox" />
                        <span>Associate meeting</span>
                      </label>
                      <label className="form-field">
                        <FormFieldLabel>Record</FormFieldLabel>
                        <TargetSelect defaultTarget={target} name={`meeting.association.${index}.target`} options={targetOptions} />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <ProposalEvidence
              confidence={draft.meetingActivity.confidence}
              evidence={draft.meetingActivity.evidence}
              matchedReason={draft.meetingActivity.matchedReason}
              placementExplanation={explainMeetingActivityPlacement(draft.meetingActivity)}
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

      <section className="panel meeting-review-section" aria-labelledby="matches-heading">
        <PanelTitleRow
          actions={<CountBadge className="badge">{warningCount} warnings</CountBadge>}
          description="Confirm the source details, matched CRM records, and any ambiguous or unmatched mentions."
          title="Matches and Warnings"
          titleId="matches-heading"
        />
        {hasMatchReviewSignals ? (
          <CompactList className="meeting-match-review-list">
            {draft.sourceMetadata ? (
              <CompactListItem>
                <strong>Source metadata</strong>
                <span className="muted">
                  {sourceMetadataDetails(draft.sourceMetadata).join(" · ")}
                </span>
                {draft.sourceMetadata.warnings?.map((warning) => (
                  <Badge key={warning}>
                    {warning}
                  </Badge>
                ))}
              </CompactListItem>
            ) : null}
            {matchedObjectGroups.map((group) => (
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
                      {match.warning ? <Badge>{match.warning}</Badge> : null}
                    </CompactListItem>
                  ))}
                </CompactList>
              </CompactListItem>
            ))}
            {draft.warnings.map((warning) => (
              <CompactListItem key={warning}>
                <Badge>{warning}</Badge>
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
                      <UnmatchedEntityActions entity={entity} />
                    </CompactListItem>
                  ))}
                </CompactList>
              </CompactListItem>
            ) : null}
          </CompactList>
        ) : (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            description="No confident CRM matches or warnings were found. You can still choose targets manually in each proposal section."
            title="No match signals found"
          />
        )}
      </section>

      <section className="panel meeting-review-section" aria-labelledby="notes-heading">
        <PanelTitleRow
          actions={<CountBadge className="badge">{draft.notes.length} notes</CountBadge>}
          description="Choose which contact, company, deal, or lead timeline notes to keep and confirm the record each note should land on."
          title="Proposed Notes"
          titleId="notes-heading"
        />
        <div className="inline-form">
          {draft.notes.length > 0 ? (
            noteGroups(draft.notes).map((group) => (
              <div className="meeting-review-group" key={group.key}>
                <CompactTitleRow actions={<CountBadge className="badge">{group.items.length} notes</CountBadge>} title={group.label} />
                <div className="inline-form">
                  {group.items.map(({ index, note }) => (
                    <div className="data-card meeting-review-item" key={note.id}>
                      <div className="meeting-review-item-header">
                        <label className="form-field checkbox-field">
                          <input defaultChecked={note.include} name={`note.${index}.include`} type="checkbox" />
                          <span>Apply note</span>
                        </label>
                        <span className="meeting-review-badges">
                          <Badge>{noteKindLabel(note.kind)}</Badge>
                          {note.category ? <Badge>{proposalCategoryLabel(note.category)}</Badge> : null}
                        </span>
                      </div>
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
                        placementExplanation={explainMeetingNotePlacement(note)}
                        targetWarning={note.targetWarning}
                      />
                    </div>
                  ))}
                </div>
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

      <section className="panel meeting-review-section" aria-labelledby="relationship-brief-heading">
        <PanelTitleRow
          actions={<CountBadge className="badge">{relationshipBriefUpdates.length} memory updates</CountBadge>}
          description="Review-first curated contact memory. These suggestions update the selected contact profile, not normal timeline notes."
          title="Relationship Memory Updates"
          titleId="relationship-brief-heading"
        />
        <div className="relationship-memory-review-summary" aria-label="Relationship Memory proposal guidance">
          <div>
            <strong>Contact Relationship Memory</strong>
            <span>Accepted facts merge into the selected contact profile: personal context, tone, concerns, reminders, or internal guidance.</span>
          </div>
          <div>
            <strong>Separate from notes</strong>
            <span>Company, deal, lead, and raw timeline facts stay in Proposed Notes above unless you choose otherwise.</span>
          </div>
          <div>
            <strong>Review-first safety</strong>
            <span>Included facts can be edited, excluded, or moved before anything is written.</span>
          </div>
        </div>
        <div className="inline-form">
          {relationshipBriefUpdates.length > 0 ? (
            relationshipBriefUpdates.map((update, index) => {
              const facts = relationshipFactDrafts[index] ?? relationshipFactsForReview(update);
              const selectedTarget = selectedRelationshipTargets[index] ?? null;
              const targetBriefState = relationshipBriefTargetStates[index] ?? initialRelationshipBriefTargetState(update);
              const existing = relationshipExistingFieldsForPreview(targetBriefState);
              const mergedPreview = relationshipMergedPreviewFromFacts(existing, facts);
              return (
                <div className="data-card meeting-review-item" key={update.id}>
                  <div className="meeting-review-item-header">
                    <label className="form-field checkbox-field">
                      <input defaultChecked={update.include} name={`relationship.${index}.include`} type="checkbox" />
                      <span>Update Relationship Memory</span>
                    </label>
                    <Badge>{targetDisplayLabel(selectedTarget)}</Badge>
                  </div>
                  <div className="form-grid">
                    <label className="form-field">
                      <FormFieldLabel>Contact</FormFieldLabel>
                      <TargetSelect
                        onChange={(value) => onRelationshipTargetChange(index, value)}
                        value={selectedTarget ? targetValue(selectedTarget) : ""}
                        name={`relationship.${index}.target`}
                        options={relationshipOptions}
                      />
                    </label>
                  </div>
                  <RelationshipBriefTargetStatus state={targetBriefState} target={selectedTarget} />
                  <div className="relationship-brief-review-grid">
                    {relationshipBriefSections.map((section) => {
                      const fieldFacts = facts
                        .map((fact, factIndex) => ({ fact, factIndex }))
                        .filter(({ fact }) => fact.field === section.key);
                      return (
                        <section className="relationship-brief-review-field" key={section.key}>
                          <div className="relationship-memory-review-field-heading">
                            <div>
                              <strong>{section.label}</strong>
                              <p className="form-hint">{section.description}</p>
                            </div>
                            <span className="relationship-brief-usage-badges">
                              {section.badges.map((badge) => (
                                <Badge key={badge}>{badge}</Badge>
                              ))}
                              <CountBadge className="badge">{fieldFacts.length} facts</CountBadge>
                            </span>
                          </div>
                          <div className="relationship-brief-diff-grid">
                            <div className="relationship-brief-diff-column">
                              <strong>Existing</strong>
                              <p className="relationship-brief-preview-text">
                                {relationshipExistingPreviewText(targetBriefState, existing, section.key)}
                              </p>
                            </div>
                            <div className="relationship-brief-diff-column">
                              <strong>Proposed facts</strong>
                              {fieldFacts.length > 0 ? (
                                <div className="relationship-brief-fact-list">
                                  {fieldFacts.map(({ fact, factIndex }) => (
                                    <div className="relationship-brief-fact" key={`${fact.id}-${factIndex}`}>
                                      <div className="relationship-memory-fact-review-header">
                                        <label className="form-field checkbox-field">
                                          <input
                                            checked={fact.include}
                                            name={`relationship.${index}.fact.${factIndex}.include`}
                                            onChange={(event) =>
                                              onRelationshipFactChange(
                                                index,
                                                factIndex,
                                                { include: event.currentTarget.checked },
                                                { includeTouched: true }
                                              )
                                            }
                                            type="checkbox"
                                          />
                                          <span>Include fact</span>
                                        </label>
                                        <Badge>{fact.include ? "Will update memory" : "Excluded"}</Badge>
                                        {fact.category ? <Badge>{proposalCategoryLabel(fact.category)}</Badge> : null}
                                      </div>
                                      <label className="form-field form-field-wide">
                                        <FormFieldLabel>Fact</FormFieldLabel>
                                        <textarea
                                          name={`relationship.${index}.fact.${factIndex}.text`}
                                          onChange={(event) =>
                                            onRelationshipFactChange(index, factIndex, {
                                              text: event.currentTarget.value
                                            })
                                          }
                                          rows={2}
                                          value={fact.text}
                                        />
                                      </label>
                                      <label className="form-field">
                                        <FormFieldLabel>Field</FormFieldLabel>
                                        <select
                                          name={`relationship.${index}.fact.${factIndex}.field`}
                                          onChange={(event) =>
                                            onRelationshipFactChange(index, factIndex, {
                                              field: event.currentTarget.value as keyof RelationshipBriefFields
                                            })
                                          }
                                          value={fact.field}
                                        >
                                          {relationshipBriefSections.map((option) => (
                                            <option key={option.key} value={option.key}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <RelationshipBriefFactGuidance fact={fact} />
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="muted">No proposed facts for this field.</span>
                              )}
                            </div>
                            <div className="relationship-brief-diff-column">
                              <strong>After apply</strong>
                              <p className="relationship-brief-preview-text">
                                {relationshipAfterApplyPreviewText(targetBriefState, mergedPreview, section.key)}
                              </p>
                            </div>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <RelationshipBriefGuidance update={update} />
                  <ProposalEvidence
                    confidence={update.confidence}
                    evidence={update.evidence}
                    matchedReason={update.matchedReason}
                    placementExplanation={relationshipBriefPlacementExplanation(facts)}
                    targetWarning={update.targetWarning}
                  />
                </div>
              );
            })
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="Relationship Memory suggestions appear only when the meeting contains explicit contact context worth curating."
              title="No relationship memory updates proposed"
            />
          )}
        </div>
      </section>

      <section className="panel meeting-review-section" aria-labelledby="next-steps-heading">
        <PanelTitleRow
          actions={<CountBadge className="badge">{draft.nextStepActivities.length} follow-ups</CountBadge>}
          description="Confirm owner, due date, and target before creating follow-up tasks."
          title="Follow-Ups"
          titleId="next-steps-heading"
        />
        <div className="inline-form">
          {draft.nextStepActivities.length > 0 ? (
            draft.nextStepActivities.map((activity, index) => (
              <div className="data-card meeting-review-item" key={activity.id}>
                <div className="meeting-review-item-header">
                  <label className="form-field checkbox-field">
                    <input defaultChecked={activity.include} name={`next.${index}.include`} type="checkbox" />
                    <span>Create follow-up</span>
                  </label>
                  <span className="meeting-review-badges">{activityBadges(activity).map((badge) => <Badge key={badge}>{badge}</Badge>)}</span>
                </div>
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
                  placementExplanation={explainMeetingActivityPlacement(activity)}
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

      <section className="panel meeting-review-section" aria-labelledby="markdown-preview-heading">
        <PanelTitleRow
          actions={<Badge>Source preview</Badge>}
          description="This is the normalized markdown that powered the proposal. Use it to spot extraction or transcription misses before apply."
          title="Normalized Markdown"
          titleId="markdown-preview-heading"
        />
        <pre className="meeting-markdown-preview">{draft.markdown}</pre>
      </section>

      <section className="panel meeting-review-section" aria-labelledby="apply-summary-heading">
        <PanelTitleRow
          actions={<CountBadge className="badge">{selectedUpdateCount} selected</CountBadge>}
          description={`${proposedUpdateCount} proposed updates. ${missingTargetCount} selected updates missing targets.`}
          title="Apply Summary"
          titleId="apply-summary-heading"
        />
        <CompactList>
          <CompactListItem>
            <strong>Default selected updates</strong>
            <span className="muted">{defaultApplySummary(draft)}</span>
          </CompactListItem>
          <CompactListItem className="meeting-apply-safety-note">
            <strong>Review-first safety</strong>
            <span className="muted">Nothing is written to notes, activities, associations, or Relationship Memory fields until you apply selected updates.</span>
          </CompactListItem>
          {missingTargetCount > 0 ? (
            <CompactListItem className="meeting-apply-warning">
              <Badge>Untargeted selected updates will be skipped.</Badge>
            </CompactListItem>
          ) : null}
        </CompactList>
      </section>

      <FormActionBar
        cancelHref={"/meeting-intelligence" as Route}
        cancelLabel="Back"
        disabledHint="Wait for the selected contact Relationship Memory preview to load, or choose another contact."
        isSaving={isSaving}
        pendingLabel="Applying..."
        submitDisabled={relationshipBriefPreviewBlocked}
        submitActionLabel="Apply reviewed Meeting Intelligence updates"
        submitLabel="Apply selected updates"
      />
    </form>
  );
}

function ReviewOrientationSummary({
  missingTargetCount,
  proposedUpdateCount,
  selectedUpdateCount,
  warningCount
}: {
  missingTargetCount: number;
  proposedUpdateCount: number;
  selectedUpdateCount: number;
  warningCount: number;
}) {
  return (
    <section className="meeting-review-overview" aria-label="Meeting Intelligence review summary">
      <div className="meeting-review-overview-item">
        <strong>Review-first</strong>
        <span>Editable proposals only until you apply.</span>
      </div>
      <div className="meeting-review-overview-item">
        <strong>{selectedUpdateCount}/{proposedUpdateCount} selected</strong>
        <span>Notes, logs, follow-ups, and brief updates stay optional.</span>
      </div>
      <div className="meeting-review-overview-item">
        <strong>{warningCount} warnings</strong>
        <span>Check source, match, and sensitivity signals.</span>
      </div>
      <div className="meeting-review-overview-item">
        <strong>{missingTargetCount} need targets</strong>
        <span>Selected untargeted updates are skipped at apply.</span>
      </div>
    </section>
  );
}

function ProposalCategoryOverview({ draft }: { draft: MeetingIntelligenceDraft }) {
  const relationshipFacts = (draft.relationshipBriefUpdates ?? []).flatMap((update) => relationshipFactsForReview(update));
  const categories = [
    {
      count: relationshipFacts.filter((fact) => fact.category === "personFact" || !fact.category).length,
      description: "Contact-specific Relationship Memory facts only.",
      label: "People / contact facts"
    },
    {
      count: draft.notes.filter((note) => note.category === "organizationFact" || note.kind === "company_fact").length,
      description: "Company or account facts stay on organization notes.",
      label: "Organizations / company facts"
    },
    {
      count: draft.notes.filter((note) => note.category === "dealFact" || note.kind === "deal_fact" || note.kind === "lead_fact").length,
      description: "Opportunity, lead, budget, timeline, legal, and scope facts stay off personal memory.",
      label: "Deals / opportunity facts"
    },
    {
      count: draft.notes.filter((note) => note.category === "stakeholderNote" || note.kind === "stakeholder_note").length,
      description: "Buyer-role and stakeholder details are flagged separately for review.",
      label: "Stakeholders"
    },
    {
      count: draft.nextStepActivities.filter((activity) => activity.category === "followUpAction" || activity.include).length,
      description: "Actions are proposed as activities, not stored as personal memory.",
      label: "Follow-up actions"
    },
    {
      count:
        draft.unmatchedEntities.length +
        draft.matchedObjects.filter((match) => match.confidence === "ambiguous").length +
        draft.notes.filter((note) => note.category === "ambiguousNeedsReview").length,
      description: "Ambiguous matches or facts need a reviewer to choose the right target.",
      label: "Needs review / ambiguous"
    }
  ];

  return (
    <section className="panel meeting-review-section" aria-labelledby="meeting-proposal-categories-heading">
      <PanelTitleRow
        actions={<CountBadge className="badge">{categories.reduce((sum, item) => sum + item.count, 0)} signals</CountBadge>}
        description="Review proposals by destination before applying any CRM changes."
        title="Proposal Categories"
        titleId="meeting-proposal-categories-heading"
      />
      <div className="relationship-memory-review-summary" aria-label="Meeting proposal categories">
        {categories.map((category) => (
          <div key={category.label}>
            <strong>{category.label}</strong>
            <span>
              {category.count} proposed. {category.description}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MeetingSummaryBlock({ associatedTargets, summary }: { associatedTargets: CrmTarget[]; summary: string }) {
  return (
    <CompactList className="meeting-proposal-evidence">
      <CompactListItem>
        <strong>Meeting summary</strong>
        <span className="muted">{summary}</span>
      </CompactListItem>
      <CompactListItem>
        <strong>Associated records</strong>
        {associatedTargets.length > 0 ? (
          <span className="meeting-review-badges">
            {associatedTargets.map((target) => (
              <Badge key={`${target.type}-${target.id}`}>
                {targetDisplayLabel(target)}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="muted">No associated CRM records were confidently matched.</span>
        )}
      </CompactListItem>
    </CompactList>
  );
}

function UnmatchedEntityActions({ entity }: { entity: UnmatchedEntity }) {
  const actions = unmatchedEntityActions(entity);
  if (actions.length === 0) return null;

  return (
    <ActionGroup className="meeting-unmatched-actions" label={`Create or search CRM records for ${entity.name}`}>
      {actions.map((action) => (
        <Link
          aria-label={`${action.label} for unmatched meeting mention ${entity.name}`}
          className="button-secondary button-compact"
          href={action.href}
          key={action.label}
          title={`${action.label} for unmatched meeting mention ${entity.name}`}
        >
          {action.label}
        </Link>
      ))}
    </ActionGroup>
  );
}

function unmatchedEntityActions(entity: UnmatchedEntity): Array<{ href: Route; label: string }> {
  const name = entity.name.trim();
  if (!name) return [];
  const encodedName = encodeURIComponent(name);
  if (entity.entityType === "person") return [{ href: `/contacts/new?name=${encodedName}` as Route, label: "Create contact" }];
  if (entity.entityType === "organization") {
    return [{ href: `/organizations/new?name=${encodedName}` as Route, label: "Create organization" }];
  }
  if (entity.entityType === "deal_or_lead") {
    return [
      { href: `/deals/new?title=${encodedName}` as Route, label: "Create deal" },
      { href: `/leads/new?title=${encodedName}&source=Meeting%20Intelligence` as Route, label: "Create lead" }
    ];
  }
  return [{ href: `/search?q=${encodedName}` as Route, label: "Search CRM" }];
}

function TargetSelect({
  defaultTarget,
  name,
  onChange,
  options,
  value
}: {
  defaultTarget?: CrmTarget | null;
  name: string;
  onChange?: (value: string) => void;
  options: TargetOption[];
  value?: string;
}) {
  return (
    <select
      name={name}
      {...(value === undefined ? { defaultValue: defaultTarget ? targetValue(defaultTarget) : "" } : { value })}
      onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
    >
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

function relationshipTargetOptions(options: MeetingIntelligenceReviewProps["options"]): TargetOption[] {
  return options.people.map((option) => ({ label: `Contact: ${option.label}`, value: `person:${option.id}` }));
}

function parseTarget(value: string): CrmTarget | null {
  const [type, id] = value.split(":");
  if (!id) return null;
  if (type === "deal" || type === "lead" || type === "person" || type === "organization") return { id, type };
  return null;
}

function parseRelationshipTarget(value: string): CrmTarget | null {
  const target = parseTarget(value);
  return target?.type === "person" ? target : null;
}

function relationshipTargetFromSelectValue(value: string, options: TargetOption[]): CrmTarget | null {
  const target = parseRelationshipTarget(value);
  if (!target) return null;
  const label = options.find((option) => option.value === value)?.label.replace(/^Contact:\s*/, "");
  return { ...target, label };
}

function targetValue(target: CrmTarget) {
  return `${target.type}:${target.id}`;
}

function targetDisplayLabel(target: CrmTarget | null) {
  if (!target) return "No target";
  const type = target.type === "person" ? "Contact" : target.type[0]?.toUpperCase() + target.type.slice(1);
  return `${type}: ${target.label ?? target.id}`;
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

function noteGroups(notes: ProposedNote[]) {
  const groups = new Map<string, { items: Array<{ index: number; note: ProposedNote }>; key: string; label: string }>();
  notes.forEach((note, index) => {
    const key = note.target ? `${note.target.type}:${note.target.id}` : "no-target";
    const existing = groups.get(key);
    const group = existing ?? { items: [], key, label: targetDisplayLabel(note.target) };
    group.items.push({ index, note });
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function noteKindLabel(kind: ProposedNote["kind"]) {
  if (kind === "personal_fact") return "Personal facts";
  if (kind === "stakeholder_note") return "Stakeholder notes";
  if (kind === "company_fact") return "Company facts";
  if (kind === "deal_fact") return "Deal facts";
  if (kind === "lead_fact") return "Lead facts";
  return "Meeting summary";
}

function proposalCategoryLabel(category: MeetingProposalFactCategory) {
  if (category === "personFact") return "Person fact";
  if (category === "organizationFact") return "Organization fact";
  if (category === "dealFact") return "Deal fact";
  if (category === "stakeholderNote") return "Stakeholder";
  if (category === "followUpAction") return "Follow-up action";
  return "Needs review";
}

function activityBadges(activity: ProposedNextStepActivity) {
  return [
    activity.type,
    proposalCategoryLabel(activity.category ?? "followUpAction"),
    activity.dueAt ? `Due ${isoToDateValue(activity.dueAt)}` : "No due date",
    targetDisplayLabel(activity.target)
  ];
}

const relationshipBriefSections = relationshipBriefUsageItems();

function fieldValue(fields: RelationshipBriefFields, key: keyof RelationshipBriefFields) {
  return fields[key] ?? "";
}

function relationshipExistingFieldsForPreview(state: RelationshipBriefTargetState): RelationshipBriefFields {
  return state.status === "ready" || state.status === "idle" ? state.existing : {};
}

function relationshipExistingPreviewText(
  state: RelationshipBriefTargetState,
  existing: RelationshipBriefFields,
  key: keyof RelationshipBriefFields
) {
  if (state.status === "loading") return "Loading selected contact brief...";
  if (state.status === "failed") return "Unable to load selected contact brief.";
  return fieldValue(existing, key) || "None saved yet";
}

function relationshipAfterApplyPreviewText(
  state: RelationshipBriefTargetState,
  mergedPreview: RelationshipBriefFields,
  key: keyof RelationshipBriefFields
) {
  if (state.status === "loading") return "Waiting for selected contact brief...";
  if (state.status === "failed") return "Preview unavailable until the selected contact brief loads.";
  return fieldValue(mergedPreview, key) || "No change";
}

function RelationshipBriefTargetStatus({ state, target }: { state: RelationshipBriefTargetState; target: CrmTarget | null }) {
  if (!target) {
    return (
      <p className="form-hint relationship-brief-target-status">
        Select a contact to preview existing Relationship Memory values before apply.
      </p>
    );
  }
  if (state.status === "loading") {
    return (
      <p className="form-hint relationship-brief-target-status relationship-brief-target-status-loading" aria-live="polite">
        Loading target Relationship Memory for {target.label ?? target.id}...
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p
        className="form-hint form-hint-danger relationship-brief-target-status relationship-brief-target-status-failed"
        aria-live="polite"
      >
        {state.error ?? "Could not load the selected contact Relationship Memory."}
      </p>
    );
  }
  return (
    <p className="form-hint relationship-brief-target-status relationship-brief-target-status-ready" aria-live="polite">
      Previewing current Relationship Memory for {target.label ?? target.id}.
    </p>
  );
}

function relationshipBriefFieldsFromPersonResponse(value: unknown): RelationshipBriefFields {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  return compactRelationshipPreviewFields({
    relationshipBusinessConcerns: stringField(input.relationshipBusinessConcerns),
    relationshipCommunicationStyle: stringField(input.relationshipCommunicationStyle),
    relationshipFollowUpReminders: stringField(input.relationshipFollowUpReminders),
    relationshipInternalGuidance: stringField(input.relationshipInternalGuidance),
    relationshipPersonalContext: stringField(input.relationshipPersonalContext)
  });
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactRelationshipPreviewFields(fields: RelationshipBriefFields): RelationshipBriefFields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => Boolean(value))) as RelationshipBriefFields;
}

type RelationshipBriefUpdate = NonNullable<MeetingIntelligenceDraft["relationshipBriefUpdates"]>[number];
type RelationshipFactDraft = ProposedRelationshipBriefFact;
type ReviewFactInput = { field: string; include: boolean; text: string };
type RelationshipBriefTargetState = {
  error?: string;
  existing: RelationshipBriefFields;
  status: "failed" | "idle" | "loading" | "ready";
  targetId: string | null;
  targetLabel?: string;
};

function initialRelationshipBriefTargetState(update: RelationshipBriefUpdate): RelationshipBriefTargetState {
  return {
    existing: update.target ? update.existing : {},
    status: update.target ? "ready" : "idle",
    targetId: update.target?.id ?? null,
    targetLabel: update.target?.label
  };
}

function relationshipFactsForReview(update: RelationshipBriefUpdate): RelationshipFactDraft[] {
  const facts = update.facts ?? relationshipFactsFromFields(update.proposed, update);
  return facts.length > 0 ? facts : relationshipFactsFromFields(update.proposed, update);
}

function relationshipFactsFromFields(
  fields: RelationshipBriefFields,
  update: Pick<RelationshipBriefUpdate, "evidence" | "id" | "sensitivity" | "warnings">
): RelationshipFactDraft[] {
  return relationshipBriefSections.flatMap((section) =>
    splitRelationshipFacts(fields[section.key]).map((text, index) => ({
      category: "personFact" as const,
      evidence: update.evidence,
      field: section.key,
      id: `${update.id}-${section.key}-${index + 1}`,
      include: true,
      sensitivity: update.sensitivity?.filter((item) => !item.field || item.field === section.key),
      text,
      warnings: update.warnings
    }))
  );
}

function updateRelationshipFact(
  setRelationshipFactDrafts: Dispatch<SetStateAction<RelationshipFactDraft[][]>>,
  updateIndex: number,
  factIndex: number,
  changes: Partial<RelationshipFactDraft>,
  options: { existing?: RelationshipBriefFields; preserveInclude?: boolean } = {}
) {
  setRelationshipFactDrafts((current) =>
    current.map((facts, index) =>
      index === updateIndex
        ? facts.map((fact, candidateIndex) =>
            candidateIndex === factIndex
              ? relationshipFactWithTargetPreview({ ...fact, ...changes }, options.existing ?? {}, options.preserveInclude)
              : fact
          )
        : facts
    )
  );
}

function reconcileRelationshipFactsForExisting(
  facts: RelationshipFactDraft[],
  existing: RelationshipBriefFields,
  updateIndex: number,
  touchedIncludes: Set<string>
) {
  return facts.map((fact, factIndex) =>
    relationshipFactWithTargetPreview(fact, existing, touchedIncludes.has(relationshipFactKey(updateIndex, factIndex)))
  );
}

function relationshipFactWithTargetPreview(
  fact: RelationshipFactDraft,
  existing: RelationshipBriefFields,
  preserveInclude = false
): RelationshipFactDraft {
  const field = relationshipBriefSections.some((section) => section.key === fact.field)
    ? fact.field
    : "relationshipPersonalContext";
  const text = fact.text.trim();
  const duplicateOfExisting = Boolean(text && relationshipFactExists(existing[field], text));
  return {
    ...fact,
    duplicateOfExisting,
    field,
    include: preserveInclude ? fact.include : Boolean(text && !duplicateOfExisting),
    staleWarning: relationshipStaleFactWarning(text),
    text
  };
}

function relationshipFactKey(updateIndex: number, factIndex: number) {
  return `${updateIndex}:${factIndex}`;
}

function relationshipProposedFieldsFromReviewFacts(facts: ReviewFactInput[]): RelationshipBriefFields {
  const fields: RelationshipBriefFields = {};
  for (const section of relationshipBriefSections) {
    const selectedFacts = facts
      .filter((fact) => fact.include && fact.field === section.key)
      .map((fact) => fact.text.trim())
      .filter(Boolean);
    if (selectedFacts.length > 0) fields[section.key] = uniqueReviewStrings(selectedFacts).join("\n");
  }
  return fields;
}

function relationshipMergedPreviewFromFacts(
  existing: RelationshipBriefFields,
  facts: RelationshipFactDraft[]
): RelationshipBriefFields {
  const preview: RelationshipBriefFields = { ...existing };
  for (const section of relationshipBriefSections) {
    const existingText = existing[section.key]?.trim();
    const additions = uniqueReviewStrings(
      facts
        .filter((fact) => fact.include && fact.field === section.key)
        .map((fact) => fact.text.trim())
        .filter((text) => Boolean(text) && !relationshipFactExists(existingText, text))
    );
    if (additions.length === 0) {
      preview[section.key] = existingText || undefined;
      continue;
    }
    preview[section.key] = [existingText, additions.join("\n")].filter(Boolean).join("\n\n");
  }
  return preview;
}

function RelationshipBriefFactGuidance({ fact }: { fact: RelationshipFactDraft }) {
  const sensitivity = fact.sensitivity ?? [];
  const warnings = [...(fact.warnings ?? []), fact.staleWarning].filter((warning): warning is string => Boolean(warning));
  if (!fact.duplicateOfExisting && sensitivity.length === 0 && warnings.length === 0) return null;
  return (
    <div className="relationship-brief-fact-guidance">
      {fact.duplicateOfExisting ? <Badge className="badge badge-lost">Likely duplicate</Badge> : null}
      {warnings.map((warning) => (
        <Badge className="badge badge-lost" key={warning}>
          {warning}
        </Badge>
      ))}
      {sensitivity.map((item, index) => (
        <span className="muted" key={`${item.category}-${item.field ?? "all"}-${index}`}>
          {sensitivityLabel(item.category)}
          {item.field ? ` (${relationshipBriefFieldLabel(item.field)})` : ""}: {item.guidance}
          {item.reason ? ` ${item.reason}` : ""}
        </span>
      ))}
    </div>
  );
}

function splitRelationshipFacts(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/\n{1,}|\s[•]\s/g)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function relationshipFactExists(existing: string | undefined, fact: string) {
  const existingNormalized = normalizeRelationshipText(existing ?? "");
  const factNormalized = normalizeRelationshipText(fact);
  return Boolean(factNormalized && existingNormalized.includes(factNormalized));
}

function normalizeRelationshipText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function relationshipStaleFactWarning(value: string) {
  if (/\b(next week|tomorrow|today|yesterday|last week|this week|this month|next month)\b/i.test(value)) {
    return "Time-sensitive fact; review whether it will stay useful.";
  }
  if (/\b(?:19|20)\d{2}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(value)) {
    return "Date-specific fact; review for staleness before saving.";
  }
  if (/\btrip|vacation|conference|event|launch|go-live|go live\b/i.test(value)) {
    return "May become stale; review after the event passes.";
  }
  return undefined;
}

function uniqueReviewStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    const key = normalizeRelationshipText(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function RelationshipBriefGuidance({ update }: { update: NonNullable<MeetingIntelligenceDraft["relationshipBriefUpdates"]>[number] }) {
  const sensitivity = update.sensitivity ?? [];
  const warnings = update.warnings ?? [];
  if (!update.providerName && sensitivity.length === 0 && warnings.length === 0) return null;
  return (
    <CompactList>
      <CompactListItem>
        {update.providerName ? <Badge>{`Provider: ${update.providerName}`}</Badge> : null}
        {sensitivity.map((item, index) => (
          <span className="muted" key={`${item.category}-${item.field ?? "all"}-${index}`}>
            {sensitivityLabel(item.category)}
            {item.field ? ` (${relationshipBriefFieldLabel(item.field)})` : ""}: {item.guidance}
            {item.reason ? ` ${item.reason}` : ""}
          </span>
        ))}
        {warnings.map((warning) => (
          <Badge className="badge badge-lost" key={warning}>{warning}</Badge>
        ))}
      </CompactListItem>
    </CompactList>
  );
}

function sensitivityLabel(category: RelationshipBriefSensitivityCategory) {
  if (category === "do_not_mention_directly") return "Do not mention directly";
  if (category === "internal_only") return "Internal only";
  if (category === "use_cautiously") return "Use cautiously";
  return "Safe personalization";
}

function relationshipBriefFieldLabel(key: keyof RelationshipBriefFields) {
  return relationshipBriefSections.find((section) => section.key === key)?.label ?? "Relationship field";
}

function sourceMetadataDetails(metadata: MeetingSourceMetadata) {
  return [
    `source: ${sourceTypeDisplay(metadata.sourceType)}`,
    metadata.filename,
    metadata.mimeType,
    metadata.pageCount ? `${metadata.pageCount} pages` : null,
    metadata.wordCount ? `${metadata.wordCount} words` : null,
    metadata.extractionMethod ? `method: ${metadata.extractionMethod}` : null,
    metadata.conversionMode ? `conversion: ${conversionDisplay(metadata.conversionMode)}` : null,
    metadata.providerName ? `provider: ${metadata.providerName}` : metadata.providerId ? `provider: ${metadata.providerId}` : null,
    `processor: ${metadata.processor}`
  ].filter((item): item is string => Boolean(item));
}

function sourceTypeDisplay(value: string) {
  if (value === "pasted_text") return "pasted text";
  if (value === "text_file") return "text file";
  if (value === "docx") return "DOCX";
  return value.replaceAll("_", " ");
}

function conversionDisplay(value: string) {
  if (value === "local") return "local";
  if (value === "provider_required") return "provider required";
  return value;
}

function meetingReviewWarningCount(draft: MeetingIntelligenceDraft) {
  const sourceWarnings = draft.sourceMetadata?.warnings?.length ?? 0;
  const matchWarnings = draft.matchedObjects.filter((match) => Boolean(match.warning)).length;
  return sourceWarnings + matchWarnings + draft.warnings.length;
}

function ProposalEvidence({
  confidence,
  evidence,
  matchedReason,
  placementExplanation,
  targetWarning
}: {
  confidence?: string;
  evidence: string[];
  matchedReason?: string;
  placementExplanation?: MeetingPlacementExplanation;
  targetWarning?: string;
}) {
  const items = evidence.filter(Boolean).slice(0, 3);
  if (!confidence && !matchedReason && !placementExplanation && !targetWarning && items.length === 0) return null;
  return (
    <CompactList>
      <CompactListItem>
        {confidence ? <Badge>{`Confidence: ${confidence}`}</Badge> : null}
        {placementExplanation ? (
          <span className="muted">
            {placementExplanation.label}: {placementExplanation.reason} Review before apply.
          </span>
        ) : null}
        {matchedReason ? <span className="muted">{matchedReason}</span> : null}
        {targetWarning ? <Badge className="badge badge-lost">{targetWarning}</Badge> : null}
        {items.map((item) => (
          <span className="muted" key={item}>
            Evidence: {item}
          </span>
        ))}
      </CompactListItem>
    </CompactList>
  );
}

function relationshipBriefPlacementExplanation(facts: RelationshipFactDraft[]) {
  const firstIncluded = facts.find((fact) => fact.include) ?? facts[0];
  return firstIncluded ? explainRelationshipFactPlacement(firstIncluded) : undefined;
}

function defaultApplySummary(draft: MeetingIntelligenceDraft) {
  const meeting = draft.meetingActivity?.include ? 1 : 0;
  const notes = draft.notes.filter((note) => note.include).length;
  const followUps = draft.nextStepActivities.filter((activity) => activity.include).length;
  const relationshipBriefs = (draft.relationshipBriefUpdates ?? []).filter((update) => update.include).length;
  return [`${meeting} meeting log`, `${notes} notes`, `${relationshipBriefs} relationship memory updates`, `${followUps} follow-ups`].join(" · ");
}

function ApplyResult({ result }: { result: ApplyMeetingIntelligenceResult }) {
  const createAnotherActionsLabel = "Applied meeting intake actions";
  const createAnotherActionLabel = "Create another meeting intelligence intake";

  return (
    <section className="panel" aria-labelledby="applied-updates-heading">
      <PanelTitleRow
        description="Created updates are linked below. Skipped items did not mutate CRM data."
        title="Applied Updates"
        titleId="applied-updates-heading"
      />
      <p className="compact-success meeting-apply-success">Meeting Intelligence apply complete. Review created CRM records below.</p>
      {result.created.length > 0 ? (
        <CompactList>
          {result.created.map((created) => (
            <CompactListItem key={`${created.type}-${created.id}`}>
              <strong>{appliedUpdateLabel(created.type)}</strong>
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
      {result.relationshipBriefChanges && result.relationshipBriefChanges.length > 0 ? (
        <>
          <CompactTitleRow
            actions={<CountBadge className="badge">{result.relationshipBriefChanges.length} fields</CountBadge>}
            title="Relationship Memory Changes"
          />
          <div className="relationship-brief-change-list">
            {result.relationshipBriefChanges.map((change, index) => (
              <div className="relationship-brief-change-card" key={`${change.target.id}-${change.field}-${index}`}>
                <CompactTitleRow
                  actions={<Badge>{change.acceptedFactCount} accepted facts</Badge>}
                  description={relationshipBriefChangeSourceLabel(change)}
                  title={`${change.target.label} · ${change.fieldLabel}`}
                />
                <div className="relationship-brief-change-diff">
                  <div>
                    <strong>Previous</strong>
                    <p className="relationship-brief-preview-text">{relationshipBriefChangeExcerpt(change.previousValue)}</p>
                  </div>
                  <div>
                    <strong>New</strong>
                    <p className="relationship-brief-preview-text">{relationshipBriefChangeExcerpt(change.newValue)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
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

function appliedUpdateLabel(type: ApplyMeetingIntelligenceResult["created"][number]["type"]) {
  if (type === "activity") return "Activity created";
  if (type === "relationship_brief") return "Relationship Memory updated";
  return "Note created";
}

function relationshipBriefChangeSourceLabel(change: NonNullable<ApplyMeetingIntelligenceResult["relationshipBriefChanges"]>[number]) {
  const title = change.source.title ?? "Meeting Intelligence intake";
  const date = change.source.occurredAt ? ` · ${isoToDateValue(change.source.occurredAt)}` : "";
  return `${title}${date}`;
}

function relationshipBriefChangeExcerpt(value: string | null) {
  if (!value?.trim()) return "None saved yet";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}
