import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AiRecordBriefCard } from "@/components/ai-record-brief-card";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { Badge } from "@/components/badge";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { MeetingPrepBriefCard } from "@/components/meeting-prep-brief-card";
import { NorthstarAssistantPanel } from "@/components/northstar-assistant-panel";
import { NotesPanel } from "@/components/notes-panel";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { getNextOpenActivity, RecordNextActivitySummary } from "@/components/record-next-activity-summary";
import { RecordHeaderActions } from "@/components/record-header-actions";
import { RecordPanelJumpNav } from "@/components/record-panel-jump-nav";
import { RelatedDealsTable, RelatedRecordsPanel } from "@/components/related-records-table";
import { RecordSummary } from "@/components/record-summary";
import { RecordTimeline } from "@/components/record-timeline";
import { RelationshipBriefPanel, type RelationshipBriefHistoryItem } from "@/components/relationship-brief-panel";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import type { RelationshipBriefChangeSummary } from "@/lib/meeting-intelligence/types";
import { formatPersonName } from "@/lib/person-name";
import { recordActivitySectionCopy } from "@/lib/record-activity-copy";
import { recordSubtitle } from "@/lib/record-subtitle";
import {
  buildAiRecordBrief,
  buildContactAssistantContext,
  buildMeetingPrepBriefForRecord,
  buildNorthstarAssistantInsight,
  getAiPreferences,
  getPerson,
  getRecordTimeline,
  getWorkspace,
  listEmailTemplates,
  listPersonCustomFields
} from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ personId: string }>;
};

type ParsedRelationshipBriefChange = {
  acceptedFactCount?: number;
  acceptedFacts?: string[];
  changedAt?: string;
  field?: string;
  fieldLabel: string;
  newValue?: string | null;
  previousValue?: string | null;
  source?: {
    intakeId?: string;
    occurredAt?: string;
    title?: string;
    type?: string;
  };
  target?: {
    id?: string;
    type?: string;
  };
};

export default async function ContactDetailPage({ params }: PageProps) {
  const { personId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const person = await getPerson(actor, personId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [workspaceDetail, timelineItems, customFields, emailTemplates, northstarContext, aiPreferences, meetingPrepBrief] = await Promise.all([
    getWorkspace(actor),
    getRecordTimeline(actor, { type: "PERSON", id: person.id }),
    listPersonCustomFields(actor, person.id),
    listEmailTemplates(actor, { activeOnly: true }),
    buildContactAssistantContext(actor, person.id),
    getAiPreferences(actor),
    buildMeetingPrepBriefForRecord(actor, { type: "person", id: person.id })
  ]);
  const northstarInsight = await buildNorthstarAssistantInsight(northstarContext, { preferences: aiPreferences });
  const aiRecordBrief = buildAiRecordBrief(northstarContext, northstarInsight, aiPreferences);
  const personName = formatPersonName(person) ?? person.email ?? "Unnamed contact";
  const nextActivity = getNextOpenActivity(person.activities);
  const activityCopy = recordActivitySectionCopy("contact");
  const emailLogCount = timelineItems.filter((item) => item.type === "email").length;
  const relationshipBrief = {
    relationshipBusinessConcerns: person.relationshipBusinessConcerns,
    relationshipCommunicationStyle: person.relationshipCommunicationStyle,
    relationshipFollowUpReminders: person.relationshipFollowUpReminders,
    relationshipInternalGuidance: person.relationshipInternalGuidance,
    relationshipPersonalContext: person.relationshipPersonalContext
  };
  const relationshipBriefCount = Object.values(relationshipBrief).filter((value) => Boolean(value?.trim())).length;
  const relationshipBriefChanges = recentRelationshipBriefChanges(person.auditLogs, person.id);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const createLinkedDealActionLabel = `Create deal linked to ${personName}`;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <RecordHeaderActions
            addHref={"#add-activity" as Route}
            backHref="/contacts"
            backLabel="Back to contacts"
            customFieldsHref={"#custom-fields" as Route}
            editHref={`/contacts/${person.id}/edit` as Route}
            editLabel="Edit contact"
            noteHref={"#notes" as Route}
            recordTitle={personName}
          />
        }
        eyebrow="Contact"
        subtitle={recordSubtitle([person.organization?.name, person.email, person.owner?.name ?? person.owner?.email])}
        title={personName}
      />

      <RecordSummary
        actions={
          <RecordPanelJumpNav
            counts={{
              activities: person.activities.length,
              auditHistory: person.auditLogs.length,
              customFields: customFields.length,
              emailLog: emailLogCount,
              linkedDeals: person.deals.length,
              notes: person.notes.length,
              timeline: timelineItems.length
            }}
            ariaLabel={`${personName} contact profile sections`}
            jumps={[
              {
                href: "#profile" as Route,
                label: "Overview",
                count: 4,
                countLabel: { singular: "profile field", plural: "profile fields" }
              },
              ...(meetingPrepBrief
                ? [{
                    href: "#meeting-prep-brief" as Route,
                    label: "Meeting prep",
                    count: 1,
                    countLabel: { singular: "upcoming meeting", plural: "upcoming meetings" }
                  }]
                : []),
              {
                href: "#ai-record-brief" as Route,
                label: "AI brief",
                count: northstarInsight.findings.length,
                countLabel: { singular: "AI finding", plural: "AI findings" }
              },
              {
                href: "#relationship-brief" as Route,
                label: "Relationship brief",
                count: relationshipBriefCount,
                countLabel: { singular: "saved memory section", plural: "saved memory sections" }
              },
              {
                href: "#notes" as Route,
                label: "Notes",
                countKey: "notes",
                countLabel: { singular: "note", plural: "notes" }
              },
              {
                href: "#activities" as Route,
                label: "Activities",
                countKey: "activities",
                countLabel: { singular: "activity", plural: "activities" }
              },
              {
                href: "#email-log" as Route,
                label: "Emails",
                countKey: "emailLog",
                countLabel: { singular: "email log", plural: "email logs" }
              },
              {
                href: "#related-deals" as Route,
                label: "Deals",
                countKey: "linkedDeals",
                countLabel: { singular: "deal", plural: "deals" }
              },
              {
                href: "#custom-fields" as Route,
                label: "Custom fields",
                countKey: "customFields",
                countLabel: { singular: "custom field", plural: "custom fields" }
              },
              {
                href: "#timeline" as Route,
                label: "Timeline",
                countKey: "timeline",
                countLabel: { singular: "timeline event", plural: "timeline events" }
              },
              {
                href: "#audit-history" as Route,
                label: "History",
                countKey: "auditHistory",
                countLabel: { singular: "audit event", plural: "audit events" }
              }
            ]}
            label="Profile sections"
          />
        }
        eyebrow="Relationship snapshot"
        items={[
          { label: "Linked deals", value: person.deals.length },
          { label: "Activities", value: person.activities.length, tone: person.activities.length > 0 ? "default" : "warning" },
          { label: "Owner", value: person.owner?.name ?? person.owner?.email ?? "Unassigned", tone: person.owner ? "default" : "muted" },
          {
            label: "Next follow-up",
            value: <RecordNextActivitySummary activity={nextActivity} emptyBadgeLabel="Needs follow-up" emptyLabel="No open contact follow-up" />,
            tone: nextActivity ? "default" : "warning"
          },
          { label: "Notes", value: person.notes.length },
          {
            label: "Organization",
            value: person.organization ? (
              <Link className="inline-link" href={`/organizations/${person.organization.id}`}>
                {person.organization.name}
              </Link>
            ) : (
              <InlineEmptyStateText>No organization linked</InlineEmptyStateText>
            ),
            tone: person.organization ? "default" : "muted"
          }
        ]}
        title="Contact workspace"
      />

      <section className="contact-profile-overview section-spaced" id="profile">
        <div className="data-card contact-profile-identity-card">
          <div className="contact-profile-heading">
            <span aria-hidden="true" className="contact-profile-avatar">
              {contactInitials(personName)}
            </span>
            <div>
              <p className="page-kicker">Contact profile</p>
              <h2>{personName}</h2>
              <p>{recordSubtitle([person.organization?.name, person.email, person.owner?.name ?? person.owner?.email]) ?? "Relationship profile"}</p>
            </div>
          </div>
          <DetailFieldGrid
            fields={[
              { emptyLabel: "No email", label: "Email", value: person.email },
              { emptyLabel: "No phone", label: "Phone", value: person.phone },
              { label: "Owner", value: person.owner?.name ?? person.owner?.email ?? "Unassigned" },
              {
                emptyLabel: "No organization",
                label: "Organization",
                value: person.organization ? (
                  <Link className="inline-link" href={`/organizations/${person.organization.id}`}>
                    {person.organization.name}
                  </Link>
                ) : (
                  null
                )
              }
            ]}
            title="Identity"
          />
        </div>
        <div className="data-card contact-profile-context-card">
          <PanelTitleRow
            actions={<Badge>Profile</Badge>}
            description="Fast relationship context before you scroll into notes, activity history, and custom fields."
            title="Relationship Context"
          />
          <div className="deal-context-metrics">
            <div>
              <span>Memory sections</span>
              <strong>{relationshipBriefCount}/5</strong>
            </div>
            <div>
              <span>Recent notes</span>
              <strong>{person.notes.length}</strong>
            </div>
            <div>
              <span>Linked deals</span>
              <strong>{person.deals.length}</strong>
            </div>
            <div>
              <span>Email logs</span>
              <strong>{emailLogCount}</strong>
            </div>
          </div>
        </div>
      </section>

      {meetingPrepBrief ? <MeetingPrepBriefCard brief={meetingPrepBrief} /> : null}

      <AiRecordBriefCard brief={aiRecordBrief} />
      <NorthstarAssistantPanel insight={northstarInsight} />

      <RelationshipBriefPanel
        contactName={personName}
        initialBrief={relationshipBrief}
        personId={person.id}
        recentChanges={relationshipBriefChanges}
        workspaceId={workspace.id}
      />

      <NotesPanel
        attachment={{ personId: person.id }}
        description="Small internal facts and follow-up notes for this person. Keep longer meeting transcripts in source records."
        emptyMessage="No notes are linked to this contact."
        notes={person.notes}
        workspaceId={workspace.id}
      />

      <RelatedRecordsPanel count={person.deals.length} id="related-deals" title="Linked Deals">
        <RelatedDealsTable
          deals={person.deals}
          emptyAction={
            <Link
              aria-label={createLinkedDealActionLabel}
              className="button-secondary button-compact"
              href={`/deals/new?personId=${person.id}` as Route}
              title={createLinkedDealActionLabel}
            >
              Create linked deal
            </Link>
          }
          emptyMessage="No deals are linked to this contact."
        />
      </RelatedRecordsPanel>

      <RecordActivitiesPanel
        attachment={{ personId: person.id }}
        defaultOwnerId={actorUserId}
        formId="add-activity"
        owners={owners}
        sections={[
          {
            activities: person.activities,
            description: activityCopy.description,
            emptyMessage: activityCopy.emptyMessage,
            showCompleteAction: true,
            title: activityCopy.title
          }
        ]}
        workspaceId={workspace.id}
      />

      <RecordCustomFieldsPanel
        emptyMessage="No contact custom fields have been created yet."
        entityId={person.id}
        entityType="PERSON"
        fields={customFields}
        workspaceId={workspace.id}
      />

      <ManualEmailLogPanel
        attachment={{ personId: person.id }}
        templates={emailTemplates}
        workspaceId={workspace.id}
      />

      <RecordTimeline items={timelineItems} />

      <AuditHistoryPanel
        emptyMessage="No audit events have been recorded for this contact yet."
        entries={person.auditLogs}
      />
    </AppShell>
  );
}

function recentRelationshipBriefChanges(
  auditLogs: Array<{
    actor?: { email: string; name: string | null } | null;
    createdAt: Date;
    metadata: unknown;
  }>,
  personId: string
): RelationshipBriefHistoryItem[] {
  return auditLogs.flatMap((log) => {
    const changes = relationshipBriefChangesFromMetadata(log.metadata);
    const changedAtFallback = log.createdAt.toISOString();
    return changes.flatMap((change) => {
      if (change.target?.id && change.target.id !== personId) return [];
      return [{
        acceptedFactCount: relationshipBriefAcceptedFactCount(change),
        acceptedFacts: relationshipBriefAcceptedFacts(change),
        actorLabel: log.actor?.name ?? log.actor?.email,
        auditBacked: true,
        changedAt: change.changedAt || changedAtFallback,
        fieldKey: relationshipBriefHistoryFieldKey(change),
        fieldLabel: change.fieldLabel,
        newValue: change.newValue ?? null,
        previousValue: change.previousValue ?? null,
        sourceIntakeId: relationshipBriefSourceString(change.source?.intakeId),
        sourceLabel: relationshipBriefHistorySourceLabel(change),
        sourceOccurredAt: relationshipBriefSourceString(change.source?.occurredAt),
        sourceTitle: relationshipBriefSourceString(change.source?.title),
        sourceType: relationshipBriefHistorySourceType(change)
      }];
    });
  }).slice(0, 5);
}

function relationshipBriefChangesFromMetadata(metadata: unknown): ParsedRelationshipBriefChange[] {
  if (!metadata || typeof metadata !== "object") return [];
  const changes = (metadata as { relationshipBriefChanges?: unknown }).relationshipBriefChanges;
  if (!Array.isArray(changes)) return [];
  return changes.filter(isRelationshipBriefChangeSummary);
}

function isRelationshipBriefChangeSummary(value: unknown): value is ParsedRelationshipBriefChange {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<RelationshipBriefChangeSummary> & {
    source?: { intakeId?: unknown; occurredAt?: unknown; title?: unknown; type?: unknown };
    target?: { id?: unknown; type?: unknown };
  };
  if (input.changedAt !== undefined && typeof input.changedAt !== "string") return false;
  if (input.field !== undefined && typeof input.field !== "string") return false;
  if (input.target && (input.target.type !== "person" || typeof input.target.id !== "string")) return false;
  if (input.source?.type !== undefined && typeof input.source.type !== "string") return false;
  return (
    typeof input.fieldLabel === "string" &&
    (input.previousValue === undefined || input.previousValue === null || typeof input.previousValue === "string") &&
    (input.newValue === undefined || input.newValue === null || typeof input.newValue === "string")
  );
}

function relationshipBriefHistorySourceLabel(change: ParsedRelationshipBriefChange) {
  const sourceType = relationshipBriefHistorySourceType(change);
  if (sourceType === "meeting_intelligence") {
    const sourceTitle = relationshipBriefSourceString(change.source?.title);
    return sourceTitle ? `Meeting Intelligence: ${sourceTitle}` : "Meeting Intelligence";
  }
  if (sourceType === "manual") return "Manual update";
  return "Relationship Brief update";
}

function relationshipBriefHistorySourceType(change: ParsedRelationshipBriefChange): RelationshipBriefHistoryItem["sourceType"] | undefined {
  if (change.source?.type === "meeting_intelligence" || change.source?.type === "manual") return change.source.type;
  return undefined;
}

function relationshipBriefHistoryFieldKey(change: ParsedRelationshipBriefChange): RelationshipBriefHistoryItem["fieldKey"] {
  if (
    change.field === "relationshipPersonalContext" ||
    change.field === "relationshipCommunicationStyle" ||
    change.field === "relationshipBusinessConcerns" ||
    change.field === "relationshipFollowUpReminders" ||
    change.field === "relationshipInternalGuidance"
  ) {
    return change.field;
  }
  if (change.fieldLabel === "Personal context") return "relationshipPersonalContext";
  if (change.fieldLabel === "Communication style") return "relationshipCommunicationStyle";
  if (change.fieldLabel === "Business concerns") return "relationshipBusinessConcerns";
  if (change.fieldLabel === "Follow-up reminders") return "relationshipFollowUpReminders";
  if (change.fieldLabel === "Internal guidance") return "relationshipInternalGuidance";
  return undefined;
}

function relationshipBriefAcceptedFactCount(change: ParsedRelationshipBriefChange) {
  if (typeof change.acceptedFactCount === "number" && Number.isFinite(change.acceptedFactCount)) return Math.max(0, change.acceptedFactCount);
  return relationshipBriefAcceptedFacts(change).length;
}

function relationshipBriefAcceptedFacts(change: ParsedRelationshipBriefChange) {
  return Array.isArray(change.acceptedFacts) ? change.acceptedFacts.filter((fact): fact is string => typeof fact === "string") : [];
}

function relationshipBriefSourceString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function contactInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .map((part) => part.trim().slice(0, 1))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials || "C";
}
