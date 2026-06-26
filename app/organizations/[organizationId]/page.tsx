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
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { getOrganization, getRecordTimeline, getWorkspace, listEmailTemplates, listOrganizationCustomFields } from "@/lib/services/crm";

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
  const [workspaceDetail, timelineItems, customFields, emailTemplates] = await Promise.all([
    getWorkspace(actor),
    getRecordTimeline(actor, { type: "ORGANIZATION", id: organization.id }),
    listOrganizationCustomFields(actor, organization.id),
    listEmailTemplates(actor, { activeOnly: true })
  ]);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Organization</p>
          <h1 className="page-title">{organization.name}</h1>
        </div>
        <div className="header-actions">
          <Link
            className="button-secondary"
            href={buildActivityFollowUpHref({
              related: { type: "organization", id: organization.id },
              title: `Follow up with ${organization.name}`,
              type: "TASK"
            })}
          >
            Add follow-up
          </Link>
          <Link className="button-secondary" href="/organizations">
            Back to organizations
          </Link>
          <Link className="button-primary" href={`/organizations/${organization.id}/edit`}>
            Edit organization
          </Link>
        </div>
      </header>

      <section className="detail-grid">
        <DetailFieldGrid
          fields={[
            { label: "Domain", value: organization.domain ?? "None" },
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
        <div className="data-card">
          <h2 className="panel-title">Custom Fields</h2>
          <RecordCustomFieldsForm
            emptyMessage="No organization custom fields have been created yet."
            entityId={organization.id}
            entityType="ORGANIZATION"
            fields={customFields.map((field) => ({
              id: field.id,
              name: field.name,
              key: field.key,
              fieldType: field.fieldType,
              options: field.options,
              required: field.required,
              value: field.values[0]?.value
            }))}
            workspaceId={workspace.id}
          />
        </div>
      </section>

      <section className="data-card" style={{ marginTop: 14 }}>
        <h2 className="panel-title">People</h2>
        {organization.people.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {organization.people.map((person) => (
                <tr key={person.id}>
                  <td>
                    <Link className="inline-link" href={`/contacts/${person.id}`}>
                      {formatPersonName(person)}
                    </Link>
                  </td>
                  <td>{person.email ?? "None"}</td>
                  <td>{person.phone ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-copy">No people are linked to this organization.</p>
        )}
      </section>

      <section className="data-card" style={{ marginTop: 14 }}>
        <h2 className="panel-title">Deals</h2>
        {organization.deals.length > 0 ? (
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
              {organization.deals.map((deal) => (
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
          <p className="empty-copy">No deals are linked to this organization.</p>
        )}
      </section>

      <RecordActivitiesPanel
        attachment={{ organizationId: organization.id }}
        defaultOwnerId={actorUserId}
        owners={owners}
        sections={[
          {
            activities: organization.activities,
            emptyMessage: "No activities are linked to this organization.",
            showCompleteAction: true,
            title: "Activities"
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

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
