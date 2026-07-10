import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AiRecordBriefCard } from "@/components/ai-record-brief-card";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { MeetingPrepBriefCard } from "@/components/meeting-prep-brief-card";
import { NotesPanel } from "@/components/notes-panel";
import { PageHeader } from "@/components/page-header";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { getNextOpenActivity, RecordNextActivitySummary } from "@/components/record-next-activity-summary";
import { RecordHeaderActions } from "@/components/record-header-actions";
import { RecordPanelJumpNav } from "@/components/record-panel-jump-nav";
import { RelatedDealsTable, RelatedPeopleTable, RelatedRecordsPanel } from "@/components/related-records-table";
import { RecordSummary } from "@/components/record-summary";
import { RecordTimeline } from "@/components/record-timeline";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { recordActivitySectionCopy } from "@/lib/record-activity-copy";
import { recordSubtitle } from "@/lib/record-subtitle";
import {
  buildAiRecordBrief,
  buildMeetingPrepBriefForRecord,
  buildNorthstarAssistantInsight,
  buildOrganizationAssistantContext,
  getAiPreferences,
  getOrganization,
  getRecordTimeline,
  getWorkspace,
  listEmailTemplates,
  listOrganizationCustomFields
} from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationDetailPage({ params }: PageProps) {
  const { organizationId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const organization = await getOrganization(actor, organizationId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [workspaceDetail, timelineItems, customFields, emailTemplates, northstarContext, aiPreferences, meetingPrepBrief] = await Promise.all([
    getWorkspace(actor),
    getRecordTimeline(actor, { type: "ORGANIZATION", id: organization.id }),
    listOrganizationCustomFields(actor, organization.id),
    listEmailTemplates(actor, { activeOnly: true }),
    buildOrganizationAssistantContext(actor, organization.id),
    getAiPreferences(actor),
    buildMeetingPrepBriefForRecord(actor, { type: "organization", id: organization.id })
  ]);
  const northstarInsight = await buildNorthstarAssistantInsight(northstarContext, { preferences: aiPreferences });
  const aiRecordBrief = buildAiRecordBrief(northstarContext, northstarInsight, aiPreferences);
  const nextActivity = getNextOpenActivity(organization.activities);
  const activityCopy = recordActivitySectionCopy("organization");
  const emailLogCount = timelineItems.filter((item) => item.type === "email").length;
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const addPersonActionLabel = `Add person linked to ${organization.name}`;
  const createLinkedDealActionLabel = `Create deal linked to ${organization.name}`;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <RecordHeaderActions
            addHref={"#add-activity" as Route}
            backHref="/organizations"
            backLabel="Back to organizations"
            customFieldsHref={"#custom-fields" as Route}
            editHref={`/organizations/${organization.id}/edit` as Route}
            editLabel="Edit organization"
            noteHref={"#notes" as Route}
            recordTitle={organization.name}
          />
        }
        eyebrow="Organization"
        subtitle={recordSubtitle([organization.domain, organization.owner?.name ?? organization.owner?.email])}
        title={organization.name}
      />

      <RecordSummary
        actions={
          <RecordPanelJumpNav
            counts={{
              activities: organization.activities.length,
              auditHistory: organization.auditLogs.length,
              customFields: customFields.length,
              emailLog: emailLogCount,
              linkedDeals: organization.deals.length,
              linkedPeople: organization.people.length,
              notes: organization.notes.length,
              timeline: timelineItems.length
            }}
            ariaLabel={`${organization.name} organization sections`}
            jumps={[
              {
                href: "#overview" as Route,
                label: "Overview"
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
                href: "#related-people" as Route,
                label: "People",
                countKey: "linkedPeople",
                countLabel: { singular: "person", plural: "people" }
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
            label="Sections"
          />
        }
        eyebrow="Account snapshot"
        items={[
          { label: "People", value: organization.people.length, tone: organization.people.length > 0 ? "default" : "warning" },
          { label: "Deals", value: organization.deals.length },
          { label: "Activities", value: organization.activities.length },
          { label: "Owner", value: organization.owner?.name ?? organization.owner?.email ?? "Unassigned", tone: organization.owner ? "default" : "muted" },
          {
            label: "Next follow-up",
            value: <RecordNextActivitySummary activity={nextActivity} emptyBadgeLabel="Needs follow-up" emptyLabel="No open organization follow-up" />,
            tone: nextActivity ? "default" : "warning"
          },
          { label: "Notes", value: organization.notes.length }
        ]}
        title="Organization workspace"
      />

      {meetingPrepBrief ? <MeetingPrepBriefCard brief={meetingPrepBrief} /> : null}

      <AiRecordBriefCard brief={aiRecordBrief} />

      <section className="detail-grid" id="overview">
        <DetailFieldGrid
          fields={[
            { emptyLabel: "No domain", label: "Domain", value: organization.domain },
            { label: "Owner", value: organization.owner?.name ?? organization.owner?.email ?? "Unassigned" }
          ]}
        />
        <NotesPanel
          attachment={{ organizationId: organization.id }}
          emptyMessage="No notes are linked to this organization."
          notes={organization.notes}
          topMargin={false}
          workspaceId={workspace.id}
        />
      </section>

      <RecordCustomFieldsPanel
        emptyMessage="No organization custom fields have been created yet."
        entityId={organization.id}
        entityType="ORGANIZATION"
        fields={customFields}
        workspaceId={workspace.id}
      />

      <RelatedRecordsPanel count={organization.people.length} id="related-people" title="People">
        <RelatedPeopleTable
          emptyAction={
            <Link
              aria-label={addPersonActionLabel}
              className="button-secondary button-compact"
              href={`/contacts/new?organizationId=${organization.id}` as Route}
              title={addPersonActionLabel}
            >
              Add person
            </Link>
          }
          emptyMessage="No people are linked to this organization."
          people={organization.people}
        />
      </RelatedRecordsPanel>

      <RelatedRecordsPanel count={organization.deals.length} id="related-deals" title="Deals">
        <RelatedDealsTable
          deals={organization.deals}
          emptyAction={
            <Link
              aria-label={createLinkedDealActionLabel}
              className="button-secondary button-compact"
              href={`/deals/new?organizationId=${organization.id}` as Route}
              title={createLinkedDealActionLabel}
            >
              Create linked deal
            </Link>
          }
          emptyMessage="No deals are linked to this organization."
        />
      </RelatedRecordsPanel>

      <RecordActivitiesPanel
        attachment={{ organizationId: organization.id }}
        defaultOwnerId={actorUserId}
        formId="add-activity"
        owners={owners}
        sections={[
          {
            activities: organization.activities,
            description: activityCopy.description,
            emptyMessage: activityCopy.emptyMessage,
            showCompleteAction: true,
            title: activityCopy.title
          }
        ]}
        workspaceId={workspace.id}
      />

      <ManualEmailLogPanel
        attachment={{ organizationId: organization.id }}
        templates={emailTemplates}
        workspaceId={workspace.id}
      />

      <RecordTimeline items={timelineItems} />

      <AuditHistoryPanel
        emptyMessage="No audit events have been recorded for this organization yet."
        entries={organization.auditLogs}
      />
    </AppShell>
  );
}
