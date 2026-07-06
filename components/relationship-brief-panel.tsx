"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { PanelTitleRow } from "@/components/panel-title-row";

export type RelationshipBriefValue = {
  relationshipBusinessConcerns: string | null;
  relationshipCommunicationStyle: string | null;
  relationshipFollowUpReminders: string | null;
  relationshipInternalGuidance: string | null;
  relationshipPersonalContext: string | null;
};

export type RelationshipBriefHistoryItem = {
  acceptedFactCount?: number;
  actorLabel?: string;
  changedAt: string;
  fieldLabel: string;
  newValue: string | null;
  previousValue: string | null;
  sourceLabel: string;
};

type RelationshipBriefPanelProps = {
  contactName: string;
  initialBrief: RelationshipBriefValue;
  personId: string;
  recentChanges?: RelationshipBriefHistoryItem[];
  workspaceId: string;
};

const briefSections = [
  {
    key: "relationshipPersonalContext",
    label: "Personal context",
    emptyLabel: "No personal context saved"
  },
  {
    key: "relationshipCommunicationStyle",
    label: "Communication style",
    emptyLabel: "No communication preference saved"
  },
  {
    key: "relationshipBusinessConcerns",
    label: "Business concerns",
    emptyLabel: "No business concerns saved"
  },
  {
    key: "relationshipFollowUpReminders",
    label: "Follow-up reminders",
    emptyLabel: "No relationship reminders saved"
  },
  {
    key: "relationshipInternalGuidance",
    label: "Internal guidance",
    emptyLabel: "No internal guidance saved"
  }
] satisfies Array<{ emptyLabel: string; key: keyof RelationshipBriefValue; label: string }>;

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
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savedCount = relationshipBriefCount(brief);
  const editActionLabel = `${isEditing ? "Cancel editing" : "Edit"} relationship brief for ${contactName}`;

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
      setError(responseBody?.error?.message ?? "Could not save the relationship brief.");
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
        title="Relationship Brief"
      />

      {isEditing ? (
        <form className="section-spaced" onSubmit={onSubmit}>
          {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
          <div className="form-grid">
            {briefSections.map((section) => (
              <label className="form-field form-field-wide" key={section.key}>
                <FormFieldLabel>{section.label}</FormFieldLabel>
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
              {isSaving ? "Saving..." : "Save relationship brief"}
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
      ) : savedCount > 0 ? (
        <dl className="field-grid section-spaced">
          {briefSections.map((section) => (
            <div className="field-grid-item" key={section.key}>
              <dt className="field-label">{section.label}</dt>
              <dd className="field-value">{brief[section.key] || <InlineEmptyStateText>{section.emptyLabel}</InlineEmptyStateText>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <EmptyState
          className="empty-state-compact empty-state-panel section-spaced"
          title="No relationship brief has been saved for this contact yet."
        />
      )}

      {recentChanges.length > 0 ? (
        <div className="section-spaced">
          <PanelTitleRow
            actions={<CountBadge label={`Recent relationship brief changes: ${recentChanges.length}`}>{recentChanges.length}</CountBadge>}
            title="Recent Relationship Brief Changes"
          />
          <div className="relationship-brief-change-list">
            {recentChanges.map((change, index) => (
              <div className="relationship-brief-change-card" key={`${change.changedAt}-${change.fieldLabel}-${index}`}>
                <div>
                  <strong>{change.fieldLabel}</strong>
                  <p className="form-hint">
                    {change.sourceLabel} · {formatHistoryDate(change.changedAt)}
                    {change.actorLabel ? ` · ${change.actorLabel}` : ""}
                    {change.acceptedFactCount !== undefined ? ` · ${change.acceptedFactCount} accepted facts` : ""}
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
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function relationshipBriefCount(brief: RelationshipBriefValue) {
  return briefSections.filter((section) => Boolean(brief[section.key]?.trim())).length;
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

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
