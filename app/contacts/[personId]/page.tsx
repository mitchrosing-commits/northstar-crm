import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { RecordCustomFieldsForm } from "@/components/record-custom-fields-form";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { formatDate, formatMoney } from "@/components/format";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { NotesPanel } from "@/components/notes-panel";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { RecordTimeline } from "@/components/record-timeline";
import { StatusBadge } from "@/components/status-badge";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
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
  const personName = formatPersonName(person);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Contact</p>
          <h1 className="page-title">{personName}</h1>
        </div>
        <div className="header-actions">
          <Link className="button-secondary" href="/contacts">
            Back to contacts
          </Link>
          <Link className="button-primary" href={`/contacts/${person.id}/edit`}>
            Edit contact
          </Link>
        </div>
      </header>

      <section className="detail-grid">
        <DetailFieldGrid
          fields={[
            { label: "Email", value: person.email ?? "None" },
            { label: "Phone", value: person.phone ?? "None" },
            { label: "Owner", value: person.owner?.name ?? person.owner?.email ?? "Unassigned" },
            {
              label: "Organization",
              value: person.organization ? (
                <Link className="inline-link" href={`/organizations/${person.organization.id}`}>
                  {person.organization.name}
                </Link>
              ) : (
                "None"
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

      <section className="data-card" style={{ marginTop: 14 }}>
        <h2 className="panel-title">Custom Fields</h2>
        <RecordCustomFieldsForm
          emptyMessage="No contact custom fields have been created yet."
          entityId={person.id}
          entityType="PERSON"
          fields={customFields.map((field) => ({
            id: field.id,
            name: field.name,
            key: field.key,
            fieldType: field.fieldType,
            options: field.options,
            required: field.required,
            value: field.values[0]?.value ?? null
          }))}
          workspaceId={workspace.id}
        />
      </section>

      <section className="data-card" style={{ marginTop: 14 }}>
        <h2 className="panel-title">Linked Deals</h2>
        {person.deals.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Value</th>
                <th>Status</th>
                <th>Expected close</th>
              </tr>
            </thead>
            <tbody>
              {person.deals.map((deal) => (
                <tr key={deal.id}>
                  <td>
                    <Link className="inline-link" href={`/deals/${deal.id}`}>
                      {deal.title}
                    </Link>
                  </td>
                  <td>{formatMoney(deal.valueCents, deal.currency)}</td>
                  <td>
                    <StatusBadge status={deal.status} />
                  </td>
                  <td>{formatDate(deal.expectedCloseAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-copy">No deals are linked to this contact.</p>
        )}
      </section>

      <RecordActivitiesPanel
        attachment={{ personId: person.id }}
        defaultOwnerId={actorUserId}
        owners={owners}
        sections={[
          {
            activities: person.activities,
            emptyMessage: "No activities are linked to this contact.",
            showCompleteAction: true,
            title: "Activities"
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

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
