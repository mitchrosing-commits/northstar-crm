import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { NotesPanel } from "@/components/notes-panel";
import { PageHeader } from "@/components/page-header";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { getNextOpenActivity, RecordNextActivitySummary } from "@/components/record-next-activity-summary";
import { RecordHeaderActions } from "@/components/record-header-actions";
import { RecordPanelJumpNav } from "@/components/record-panel-jump-nav";
import { RelatedDealsTable, RelatedRecordsPanel } from "@/components/related-records-table";
import { RecordSummary } from "@/components/record-summary";
import { RecordTimeline } from "@/components/record-timeline";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import { recordActivitySectionCopy } from "@/lib/record-activity-copy";
import { recordSubtitle } from "@/lib/record-subtitle";
import { getPerson, getRecordTimeline, getWorkspace, listEmailTemplates, listPersonCustomFields } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ personId: string }>;
};

export default async function ContactDetailPage({ params }: PageProps) {
  const { personId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const person = await getPerson(actor, personId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [workspaceDetail, timelineItems, customFields, emailTemplates] = await Promise.all([
    getWorkspace(actor),
    getRecordTimeline(actor, { type: "PERSON", id: person.id }),
    listPersonCustomFields(actor, person.id),
    listEmailTemplates(actor, { activeOnly: true })
  ]);
  const personName = formatPersonName(person) ?? person.email ?? "Unnamed contact";
  const nextActivity = getNextOpenActivity(person.activities);
  const activityCopy = recordActivitySectionCopy("contact");
  const emailLogCount = timelineItems.filter((item) => item.type === "email").length;
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
              notes: person.notes.length,
              timeline: timelineItems.length
            }}
            extraJumps={[
              {
                href: "#related-deals" as Route,
                label: "Deals",
                count: person.deals.length,
                countLabel: { singular: "deal", plural: "deals" }
              }
            ]}
          />
        }
        eyebrow="Relationship snapshot"
        items={[
          { label: "Linked deals", value: person.deals.length },
          { label: "Activities", value: person.activities.length, tone: person.activities.length > 0 ? "default" : "warning" },
          { label: "Owner", value: person.owner?.name ?? person.owner?.email ?? "Unassigned", tone: person.owner ? "default" : "muted" },
          {
            label: "Next follow-up",
            value: <RecordNextActivitySummary activity={nextActivity} />,
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

      <section className="detail-grid">
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
        />
        <NotesPanel
          attachment={{ personId: person.id }}
          emptyMessage="No notes are linked to this contact."
          notes={person.notes}
          topMargin={false}
          workspaceId={workspace.id}
        />
      </section>

      <RecordCustomFieldsPanel
        emptyMessage="No contact custom fields have been created yet."
        entityId={person.id}
        entityType="PERSON"
        fields={customFields}
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
