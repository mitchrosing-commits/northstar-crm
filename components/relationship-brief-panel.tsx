"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/badge";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { PanelTitleRow } from "@/components/panel-title-row";
import {
  relationshipBriefUsageItems,
  type RelationshipBriefFieldKey,
  type RelationshipBriefUsageGuidance
} from "@/lib/relationship-brief-usage";

export type RelationshipBriefValue = {
  relationshipBusinessConcerns: string | null;
  relationshipCommunicationStyle: string | null;
  relationshipFollowUpReminders: string | null;
  relationshipInternalGuidance: string | null;
  relationshipPersonalContext: string | null;
};

export type RelationshipBriefHistoryItem = {
  acceptedFactCount?: number;
  acceptedFacts?: string[];
  actorLabel?: string;
  auditBacked?: boolean;
  changedAt: string;
  fieldKey?: RelationshipBriefFieldKey;
  fieldLabel: string;
  newValue: string | null;
  previousValue: string | null;
  sourceIntakeId?: string;
  sourceLabel: string;
  sourceOccurredAt?: string;
  sourceTitle?: string;
  sourceType?: "manual" | "meeting_intelligence";
};

type RelationshipBriefPanelProps = {
  contactName: string;
  initialBrief: RelationshipBriefValue;
  personId: string;
  recentChanges?: RelationshipBriefHistoryItem[];
  workspaceId: string;
};

type RelationshipBriefHistorySourceFilter = "all" | "manual" | "meeting_intelligence";
type RelationshipBriefHistoryFieldFilter = "all" | RelationshipBriefFieldKey;

const briefSections = relationshipBriefUsageItems();

const sensitivityGuidance = [
  "Safe personalization: useful context the contact voluntarily shared.",
  "Internal-only guidance: private team notes for judgment, not customer-facing copy.",
  "Use cautiously: business concerns or sensitive context that should be handled with care.",
  "Do not mention directly: avoid storing protected traits or overly sensitive personal data."
];

export function RelationshipBriefPanel({
  contactName,
  initialBrief,
  personId,
  recentChanges = [],
  workspaceId
}: RelationshipBriefPanelProps) {
  const router = useRouter();
  const [brief, setBrief] = useState(initialBrief);
  const [draft, setDraft] = useState(() => relationshipBriefDraft(initialBrief));
  const [error, setError] = useState<string | null>(null);
  const [historyFieldFilter, setHistoryFieldFilter] = useState<RelationshipBriefHistoryFieldFilter>("all");
  const [historySourceFilter, setHistorySourceFilter] = useState<RelationshipBriefHistorySourceFilter>("all");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savedCount = relationshipBriefCount(brief);
  const filteredRecentChanges = relationshipBriefFilteredChanges(recentChanges, historySourceFilter, historyFieldFilter);
  const changedFieldCounts = relationshipBriefChangedFieldCounts(recentChanges);
  const meetingIntelligenceChangeCount = recentChanges.filter((change) => change.sourceType === "meeting_intelligence").length;
  const manualChangeCount = recentChanges.filter((change) => change.sourceType === "manual").length;
  const editActionLabel = `${isEditing ? "Cancel editing" : "Edit"} relationship memory for ${contactName}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/people/${personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(relationshipBriefPayload(draft))
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not save the relationship memory.");
      setIsSaving(false);
      return;
    }

    const updated = await response.json();
    const nextBrief = normalizeRelationshipBriefValue(updated);
    setBrief(nextBrief);
    setDraft(relationshipBriefDraft(nextBrief));
    setIsEditing(false);
    setIsSaving(false);
    router.refresh();
  }

  return (
    <section className="data-card section-spaced" id="relationship-brief">
      <PanelTitleRow
        actions={
          <>
            <CountBadge label={`Relationship brief saved sections: ${savedCount}`}>{savedCount}</CountBadge>
            <button
              aria-label={editActionLabel}
              className="button-secondary button-compact"
              onClick={() => {
                setError(null);
                setDraft(relationshipBriefDraft(brief));
                setIsEditing((editing) => !editing);
              }}
              title={editActionLabel}
              type="button"
            >
              {isEditing ? "Cancel" : "Edit"}
            </button>
          </>
        }
        actionsLabel="Relationship brief actions"
        description="Curated relationship context for thoughtful follow-up. Keep personal details limited to what was voluntarily shared and useful."
        title="Relationship Memory"
      />

      {isEditing ? (
        <form className="relationship-memory-edit-form section-spaced" onSubmit={onSubmit}>
          {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
          <div className="relationship-brief-guidance" aria-label="Relationship Memory sensitivity guidance">
            {sensitivityGuidance.map((guidance) => (
              <Badge key={guidance}>{guidance}</Badge>
            ))}
          </div>
          <p className="form-hint">
            Keep this as curated relationship memory. Do not store protected traits, confidential health or family details, or anything the team
            should not use for thoughtful follow-up.
          </p>
          <div className="relationship-memory-edit-grid">
            {briefSections.map((section) => (
              <label className="form-field relationship-memory-edit-card" key={section.key}>
                <span className="relationship-memory-card-header">
                  <FormFieldLabel>{section.label}</FormFieldLabel>
                  <span className="relationship-brief-usage-badges">
                    {section.badges.map((badge) => (
                      <Badge key={badge}>{badge}</Badge>
                    ))}
                  </span>
                </span>
                <small className="form-hint">{relationshipBriefEditHelper(section)}</small>
                <textarea
                  maxLength={2000}
                  onChange={(event) => setDraft((current) => ({ ...current, [section.key]: event.target.value }))}
                  rows={section.key === "relationshipInternalGuidance" ? 3 : 4}
                  value={draft[section.key]}
                />
              </label>
            ))}
          </div>
          <div className="form-actions form-actions-compact">
            <button className="button-primary" disabled={isSaving} type="submit">
              {isSaving ? "Saving..." : "Save relationship memory"}
            </button>
            <button
              className="button-secondary"
              disabled={isSaving}
              onClick={() => {
                setError(null);
                setDraft(relationshipBriefDraft(brief));
                setIsEditing(false);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="relationship-memory-read-view section-spaced">
          <div className="relationship-memory-overview" aria-label="Relationship Memory overview">
            <div>
              <strong>{savedCount}/5 fields captured</strong>
              <span>Personal context, tone, concerns, reminders, and internal handling guidance.</span>
            </div>
            <div>
              <strong>{meetingIntelligenceChangeCount} from Meeting Intelligence</strong>
              <span>Reviewed meeting facts can become curated contact memory after apply.</span>
            </div>
            <div>
              <strong>{manualChangeCount} manual updates</strong>
              <span>Users can add or refine details directly from this contact profile.</span>
            </div>
          </div>

          {savedCount === 0 ? (
            <EmptyState
              className="empty-state-compact empty-state-panel relationship-memory-empty-state"
              description="Use this space for voluntarily shared interests, communication preferences, business context, reminders, and private handling notes. Meeting Intelligence can suggest updates after a meeting, or you can add details manually."
              title="No relationship memory has been saved for this contact yet."
            />
          ) : null}

          <div className="relationship-memory-card-grid">
            {briefSections.map((section) => {
              const value = brief[section.key]?.trim() ?? "";
              const latestChange = relationshipBriefLatestChangeForField(recentChanges, section.key);
              return (
                <article
                  className={value ? "relationship-memory-card" : "relationship-memory-card relationship-memory-card-empty"}
                  key={section.key}
                >
                  <header className="relationship-memory-card-header">
                    <div>
                      <h3>{section.label}</h3>
                      <p className="relationship-memory-helper">{section.description}</p>
                    </div>
                    <span className="relationship-brief-usage-badges">
                      {section.badges.map((badge) => (
                        <Badge key={badge}>{badge}</Badge>
                      ))}
                    </span>
                  </header>
                  <p className="relationship-memory-value">
                    {value || <InlineEmptyStateText>{relationshipBriefEmptyPrompt(section)}</InlineEmptyStateText>}
                  </p>
                  <footer className="relationship-memory-card-meta">
                    {latestChange ? (
                      <>
                        <Badge>
                          {latestChange.sourceType ? relationshipBriefSourceTypeLabel(latestChange.sourceType) : "Source recorded"}
                        </Badge>
                        <span>
                          Last updated {formatHistoryDate(latestChange.changedAt)}
                          {latestChange.actorLabel ? ` by ${latestChange.actorLabel}` : ""}
                        </span>
                      </>
                    ) : (
                      <span>{relationshipBriefEmptySourcePrompt(section)}</span>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      )}

      <details className="relationship-brief-usage-details section-spaced">
        <summary>Usage guidance</summary>
        <div className="relationship-brief-usage-grid" aria-label="Relationship Memory usage guidance">
          {briefSections.map((section) => (
            <div className="relationship-brief-usage-card" key={section.key}>
              <div>
                <strong>{section.label}</strong>
                <div className="relationship-brief-usage-badges">
                  {section.badges.map((badge) => (
                    <Badge key={badge}>{badge}</Badge>
                  ))}
                </div>
              </div>
              <p className="form-hint">{section.customerFacingUse}</p>
              <p className="form-hint">AI/email usage: {section.aiUsage}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="section-spaced">
        <PanelTitleRow
          actions={
            <CountBadge label={`Recent relationship memory changes shown: ${filteredRecentChanges.length} of ${recentChanges.length}`}>
              {filteredRecentChanges.length}/{recentChanges.length}
            </CountBadge>
          }
          description="Filter manual edits and Meeting Intelligence updates, then open source details for read-only provenance."
          title="Source and Change History"
        />
        {recentChanges.length > 0 ? (
          <>
            <div className="relationship-brief-history-toolbar" aria-label="Relationship Memory history filters">
              <fieldset className="relationship-brief-history-source-filter">
                <legend>Source</legend>
                {[
                  { label: "All", value: "all" },
                  { label: "Manual", value: "manual" },
                  { label: "Meeting Intelligence", value: "meeting_intelligence" }
                ].map((option) => (
                  <button
                    aria-pressed={historySourceFilter === option.value}
                    className={historySourceFilter === option.value ? "button-primary button-compact" : "button-secondary button-compact"}
                    key={option.value}
                    onClick={() => setHistorySourceFilter(option.value as RelationshipBriefHistorySourceFilter)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </fieldset>
              <label className="relationship-brief-history-field-filter">
                <FormFieldLabel>Field</FormFieldLabel>
                <select
                  onChange={(event) => setHistoryFieldFilter(event.target.value as RelationshipBriefHistoryFieldFilter)}
                  value={historyFieldFilter}
                >
                  <option value="all">All fields</option>
                  {briefSections.map((section) => (
                    <option key={section.key} value={section.key}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {changedFieldCounts.length > 0 ? (
              <div className="relationship-brief-history-summary" aria-label="Relationship Memory recently changed fields">
                {changedFieldCounts.map((item) => (
                  <Badge key={item.key}>
                    {item.label}: {item.count}
                  </Badge>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {recentChanges.length === 0 ? (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            title="No Relationship Memory history has been recorded yet."
          />
        ) : filteredRecentChanges.length === 0 ? (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            title="No Relationship Memory changes match these filters."
          />
        ) : (
          <div className="relationship-brief-change-list">
            {filteredRecentChanges.map((change, index) => (
              <div className="relationship-brief-change-card" key={`${change.changedAt}-${change.fieldLabel}-${index}`}>
                <div>
                  <strong>{change.fieldLabel}</strong>
                  <p className="form-hint">
                    {change.sourceLabel} · {formatHistoryDate(change.changedAt)}
                    {change.actorLabel ? ` · ${change.actorLabel}` : ""}
                    {change.acceptedFactCount ? ` · ${change.acceptedFactCount} accepted facts` : ""}
                  </p>
                </div>
                <div className="relationship-brief-change-diff">
                  <div>
                    <strong>Previous</strong>
                    <p className="relationship-brief-preview-text">{briefHistoryExcerpt(change.previousValue)}</p>
                  </div>
                  <div>
                    <strong>New</strong>
                    <p className="relationship-brief-preview-text">{briefHistoryExcerpt(change.newValue)}</p>
                  </div>
                </div>
                <details className="relationship-brief-change-details">
                  <summary>View source details</summary>
                  <div className="relationship-brief-source-detail">
                    <dl className="relationship-brief-source-grid">
                      <div>
                        <dt>Source</dt>
                        <dd>
                          {change.sourceLabel}
                          {change.sourceType ? <Badge>{relationshipBriefSourceTypeLabel(change.sourceType)}</Badge> : null}
                        </dd>
                      </div>
                      <div>
                        <dt>Changed field</dt>
                        <dd>{change.fieldLabel}</dd>
                      </div>
                      <div>
                        <dt>Changed</dt>
                        <dd>{formatHistoryDateTime(change.changedAt)}</dd>
                      </div>
                      <div>
                        <dt>Actor</dt>
                        <dd>{change.actorLabel ?? "Unknown actor"}</dd>
                      </div>
                      {change.sourceTitle ? (
                        <div>
                          <dt>Source title</dt>
                          <dd>{change.sourceTitle}</dd>
                        </div>
                      ) : null}
                      {change.sourceOccurredAt ? (
                        <div>
                          <dt>Source date</dt>
                          <dd>{formatHistoryDate(change.sourceOccurredAt)}</dd>
                        </div>
                      ) : null}
                      {change.sourceIntakeId ? (
                        <div>
                          <dt>Source intake</dt>
                          <dd>{change.sourceIntakeId}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Status</dt>
                        <dd>{change.auditBacked ? "Audit-backed read-only history" : "Read-only history"}</dd>
                      </div>
                    </dl>
                    <p className="form-hint">{relationshipBriefHistoryGuidance(change)}</p>
                    <div className="relationship-brief-change-diff">
                      <div>
                        <strong>Previous value</strong>
                        <p className="relationship-brief-preview-text">{briefHistoryDetailText(change.previousValue)}</p>
                      </div>
                      <div>
                        <strong>New value</strong>
                        <p className="relationship-brief-preview-text">{briefHistoryDetailText(change.newValue)}</p>
                      </div>
                    </div>
                    <div className="relationship-brief-fact-list">
                      <strong>Accepted reviewed facts</strong>
                      {relationshipBriefAcceptedFacts(change).length > 0 ? (
                        <ul className="relationship-brief-source-facts">
                          {relationshipBriefAcceptedFacts(change).map((fact, factIndex) => (
                            <li key={`${fact}-${factIndex}`}>{briefHistoryDetailText(fact)}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="form-hint">No accepted reviewed facts were stored for this change.</p>
                      )}
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function relationshipBriefCount(brief: RelationshipBriefValue) {
  return briefSections.filter((section) => Boolean(brief[section.key]?.trim())).length;
}

function relationshipBriefLatestChangeForField(changes: RelationshipBriefHistoryItem[], fieldKey: RelationshipBriefFieldKey) {
  return changes.find((change) => relationshipBriefHistoryFieldKey(change) === fieldKey);
}

function relationshipBriefEmptyPrompt(section: RelationshipBriefUsageGuidance) {
  if (section.key === "relationshipPersonalContext") return "Add interests, hobbies, family context, or preferences the contact voluntarily shared.";
  if (section.key === "relationshipCommunicationStyle") return "Add preferred channel, cadence, detail level, or tone.";
  if (section.key === "relationshipBusinessConcerns") return "Add known objections, risks, priorities, or buying concerns to handle carefully.";
  if (section.key === "relationshipFollowUpReminders") return "Add human reminders or promises worth remembering before the next conversation.";
  return "Add private team guidance for handling the relationship. Do not quote it to the contact.";
}

function relationshipBriefEmptySourcePrompt(section: RelationshipBriefUsageGuidance) {
  if (section.key === "relationshipInternalGuidance") return "Manual-only or reviewed Meeting Intelligence guidance can appear here.";
  return "Meeting Intelligence can suggest this from reviewed meetings, or you can add it manually.";
}

function relationshipBriefEditHelper(section: RelationshipBriefUsageGuidance) {
  return `${section.description} ${section.customerFacingUse}`;
}

function relationshipBriefFilteredChanges(
  changes: RelationshipBriefHistoryItem[],
  sourceFilter: RelationshipBriefHistorySourceFilter,
  fieldFilter: RelationshipBriefHistoryFieldFilter
) {
  return changes.filter((change) => {
    if (sourceFilter !== "all" && change.sourceType !== sourceFilter) return false;
    if (fieldFilter !== "all" && relationshipBriefHistoryFieldKey(change) !== fieldFilter) return false;
    return true;
  });
}

function relationshipBriefChangedFieldCounts(changes: RelationshipBriefHistoryItem[]) {
  return briefSections.flatMap((section) => {
    const count = changes.filter((change) => relationshipBriefHistoryFieldKey(change) === section.key).length;
    return count > 0 ? [{ count, key: section.key, label: section.label }] : [];
  });
}

function relationshipBriefHistoryFieldKey(change: RelationshipBriefHistoryItem): RelationshipBriefFieldKey | undefined {
  if (change.fieldKey) return change.fieldKey;
  return briefSections.find((section) => section.label === change.fieldLabel)?.key;
}

function relationshipBriefDraft(brief: RelationshipBriefValue) {
  return Object.fromEntries(briefSections.map((section) => [section.key, brief[section.key] ?? ""])) as Record<
    keyof RelationshipBriefValue,
    string
  >;
}

function relationshipBriefPayload(draft: Record<keyof RelationshipBriefValue, string>) {
  return Object.fromEntries(briefSections.map((section) => [section.key, draft[section.key].trim() || null]));
}

function normalizeRelationshipBriefValue(value: Partial<RelationshipBriefValue>): RelationshipBriefValue {
  return {
    relationshipBusinessConcerns: readBriefField(value.relationshipBusinessConcerns),
    relationshipCommunicationStyle: readBriefField(value.relationshipCommunicationStyle),
    relationshipFollowUpReminders: readBriefField(value.relationshipFollowUpReminders),
    relationshipInternalGuidance: readBriefField(value.relationshipInternalGuidance),
    relationshipPersonalContext: readBriefField(value.relationshipPersonalContext)
  };
}

function readBriefField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function briefHistoryExcerpt(value: string | null) {
  if (!value?.trim()) return "None saved yet";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function briefHistoryDetailText(value: string | null) {
  if (!value?.trim()) return "None saved yet";
  const trimmed = value.trim();
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1197)}...` : trimmed;
}

function relationshipBriefAcceptedFacts(change: RelationshipBriefHistoryItem) {
  return (change.acceptedFacts ?? []).map((fact) => fact.trim()).filter(Boolean);
}

function relationshipBriefSourceTypeLabel(sourceType: NonNullable<RelationshipBriefHistoryItem["sourceType"]>) {
  return sourceType === "meeting_intelligence" ? "Meeting Intelligence" : "Manual";
}

function relationshipBriefHistoryGuidance(change: RelationshipBriefHistoryItem) {
  if (change.sourceType === "meeting_intelligence") {
    return "Review-first Meeting Intelligence provenance. Accepted facts were reviewed before apply; this detail view is read-only audit history.";
  }
  if (change.sourceType === "manual") {
    return "Manual contact-page edit. No AI or provider call is required, and viewing these details does not mutate CRM data.";
  }
  return "Read-only Relationship Memory audit detail. Older entries may have less source metadata.";
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", year: "numeric" });
}

function formatHistoryDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}
