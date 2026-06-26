import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { RecordCustomFieldsForm, RecordCustomFieldsReadOnly } from "@/components/record-custom-fields-form";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { formatDate } from "@/components/format";
import { LeadConversionForm } from "@/components/lead-conversion-form";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { NotesPanel } from "@/components/notes-panel";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { RecordTimeline } from "@/components/record-timeline";
import { StatusBadge } from "@/components/status-badge";
import { createLeadAutomationActivityAction } from "@/app/leads/actions";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { getLead, getRecordTimeline, getWorkspace, listEmailTemplates, listLeadCustomFields, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ leadId: string }>;
};

export default async function LeadDetailPage({ params }: PageProps) {
  const { leadId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const lead = await getLead(actor, leadId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [pipelines, workspaceDetail, timelineItems, customFields, emailTemplates] = await Promise.all([
    listPipelines(actor),
    getWorkspace(actor),
    getRecordTimeline(actor, { type: "LEAD", id: lead.id }),
    listLeadCustomFields(actor, lead.id),
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
          <p className="page-kicker">Lead</p>
          <h1 className="page-title">{lead.title}</h1>
        </div>
        <div className="header-actions">
          <StatusBadge status={lead.status} />
          {lead.status !== "CONVERTED" ? (
            <Link
              className="button-secondary"
              href={buildActivityFollowUpHref({
                related: { type: "lead", id: lead.id },
                title: `Follow up on ${lead.title}`,
                type: "TASK"
              })}
            >
              Add follow-up
            </Link>
          ) : null}
          <Link className="button-secondary" href="/leads">
            Back to leads
          </Link>
          {lead.status === "CONVERTED" ? (
            <button className="button-secondary" disabled type="button">
              Editing locked
            </button>
          ) : (
            <Link className="button-primary" href={`/leads/${lead.id}/edit`}>
              Edit lead
            </Link>
          )}
        </div>
      </header>

      {lead.status !== "CONVERTED" && lead.activities.length === 0 ? (
        <section className="data-card automation-template-panel" style={{ marginBottom: 14 }}>
          <div className="panel-title-row">
            <div>
              <p className="page-kicker">Suggested Automation</p>
              <h2 className="panel-title">First outreach</h2>
            </div>
            <span className="badge">Creates activity</span>
          </div>
          <p className="empty-copy">
            Create a first outreach activity for this lead. This is a one-click template, not an automatic rule.
          </p>
          <form action={createLeadAutomationActivityAction} className="automation-template-item">
            <input name="leadId" type="hidden" value={lead.id} />
            <div>
              <strong>Lead first outreach</strong>
              <p>Schedule a call for tomorrow so the lead has a clear next step.</p>
            </div>
            <button className="button-secondary button-compact" type="submit">
              Create outreach
            </button>
          </form>
        </section>
      ) : null}

      <section className="detail-grid">
        <DetailFieldGrid
          fields={[
            { label: "Source", value: lead.source ?? "None" },
            { label: "Created", value: formatDate(lead.createdAt) },
            { label: "Owner", value: lead.owner?.name ?? lead.owner?.email ?? "Unassigned" },
            {
              label: "Person",
              value: lead.person ? (
                <Link className="inline-link" href={`/contacts/${lead.person.id}`}>
                  {formatPersonName(lead.person)}
                </Link>
              ) : (
                "None"
              )
            },
            {
              label: "Organization",
              value: lead.organization ? (
                <Link className="inline-link" href={`/organizations/${lead.organization.id}`}>
                  {lead.organization.name}
                </Link>
              ) : (
                "None"
              )
            }
          ]}
        />
        <div className="data-card">
          <h2 className="panel-title">Convert to Deal</h2>
          <p className="empty-copy">
            Create a deal from this lead in a selected pipeline stage. Linked activities and notes will move to the
            new deal timeline, then Northstar opens the converted deal so you can add the next sales step.
          </p>
          {!lead.person && !lead.organization ? (
            <p className="empty-copy" style={{ marginTop: 8 }}>
              This lead has no linked contact or organization yet. You can still convert it now, or add those details first
              if you want the new deal linked from day one.
            </p>
          ) : null}
          <div style={{ marginTop: 14 }}>
            <LeadConversionForm
              leadId={lead.id}
              leadStatus={lead.status}
              leadTitle={lead.title}
              pipelines={pipelines.map((pipeline) => ({
                id: pipeline.id,
                name: pipeline.name,
                stages: pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }))
              }))}
              workspaceId={workspace.id}
            />
          </div>
        </div>
        <div className="data-card">
          <h2 className="panel-title">Custom Fields</h2>
          {lead.status === "CONVERTED" ? (
            <RecordCustomFieldsReadOnly
              emptyMessage="No lead custom fields have been created yet."
              fields={customFields.map((field) => ({
                id: field.id,
                name: field.name,
                key: field.key,
                fieldType: field.fieldType,
                options: field.options,
                required: field.required,
                value: field.values[0]?.value
              }))}
              lockedMessage="This lead has been converted. Custom fields are read-only."
            />
          ) : (
            <RecordCustomFieldsForm
              emptyMessage="No lead custom fields have been created yet."
              entityId={lead.id}
              entityType="LEAD"
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
          )}
        </div>
      </section>

      <RecordActivitiesPanel
        attachment={{ leadId: lead.id }}
        defaultOwnerId={actorUserId}
        lockedMessage="This lead has been converted. Create follow-up activities on the converted deal."
        owners={owners}
        sections={[
          {
            activities: lead.activities,
            emptyMessage: "No activities are linked to this lead.",
            showCompleteAction: true,
            title: "Activities"
          }
        ]}
        showForm={lead.status !== "CONVERTED"}
        workspaceId={workspace.id}
      />

      <NotesPanel
        attachment={{ leadId: lead.id }}
        emptyMessage="No notes are linked to this lead."
        lockedMessage="This lead has been converted. Add new context on the converted deal."
        notes={lead.notes}
        showForm={lead.status !== "CONVERTED"}
        workspaceId={workspace.id}
      />

      <ManualEmailLogPanel
        attachment={{ leadId: lead.id }}
        lockedMessage="This lead has been converted. Log new email context on the converted deal."
        showForm={lead.status !== "CONVERTED"}
        templates={emailTemplates}
        workspaceId={workspace.id}
      />

      <RecordTimeline items={timelineItems} />

      <AuditHistoryPanel
        emptyMessage="No audit events have been recorded for this lead yet."
        entries={lead.auditLogs}
      />
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
