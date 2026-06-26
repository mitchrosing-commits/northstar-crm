import { notFound } from "next/navigation";
import Link from "next/link";

import { ApiError } from "@/lib/api/responses";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { AppShell } from "@/components/app-shell";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { ContractWorkflowPanel, ContractWorkflowQuickLink } from "@/components/contract-workflow-panel";
import { DealCustomFieldsForm } from "@/components/record-custom-fields-form";
import { DealCloseActions } from "@/components/deal-close-actions";
import { DealLineItemsPanel } from "@/components/deal-line-items-panel";
import { DealStageMoveForm } from "@/components/deal-stage-move-form";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { formatActivityType, formatDate, formatMoney } from "@/components/format";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { NotesPanel } from "@/components/notes-panel";
import { QuoteDraftsPanel } from "@/components/quote-drafts-panel";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { RecordTimeline } from "@/components/record-timeline";
import { StatusBadge } from "@/components/status-badge";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { classifyDealAttention, dealAttentionLabel, type DealAttentionBucket } from "@/lib/deal-attention";
import { getDeal, getRecordTimeline, getWorkspace, listDealCustomFields, listEmailTemplates, listProducts, listStages } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string }>;
};

export default async function DealDetailPage({ params }: PageProps) {
  const { dealId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const deal = await getDeal(actor, dealId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [stages, workspaceDetail, customFields, timelineItems, products, emailTemplates] = await Promise.all([
    listStages(actor, deal.pipelineId),
    getWorkspace(actor),
    listDealCustomFields(actor, deal.id),
    getRecordTimeline(actor, { type: "DEAL", id: deal.id }),
    listProducts(actor),
    listEmailTemplates(actor, { activeOnly: true })
  ]);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const openActivities = deal.activities.filter((activity) => !activity.completedAt).sort(compareOpenActivities);
  const completedActivities = deal.activities.filter((activity) => activity.completedAt).sort(compareCompletedActivities);
  const nextActivity = openActivities[0];
  const attention = classifyDealAttention({ activities: nextActivity ? [nextActivity] : [] });
  const contractFields = customFields.map((field) => ({
    key: field.key,
    name: field.name,
    value: field.values[0]?.value ?? null
  }));

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Deal</p>
          <h1 className="page-title">{deal.title}</h1>
        </div>
        <div className="header-actions">
          <ContractWorkflowQuickLink fields={contractFields} />
          <StatusBadge status={deal.status} />
          {deal.status === "OPEN" ? (
            <>
              <Link className="button-secondary" href="#add-activity">
                Add next activity
              </Link>
              <Link className="button-secondary" href={`/deals/${deal.id}/edit`}>
                Edit deal
              </Link>
            </>
          ) : (
            <button className="button-secondary" disabled type="button">
              Editing locked
            </button>
          )}
        </div>
      </header>

      <section className="deal-context-grid">
        <DealNextStepCard activity={nextActivity} attention={attention} />
        <div className="data-card">
          <h2 className="panel-title">History Snapshot</h2>
          <div className="deal-context-metrics">
            <div>
              <span>Open activities</span>
              <strong>{openActivities.length}</strong>
            </div>
            <div>
              <span>Completed activities</span>
              <strong>{completedActivities.length}</strong>
            </div>
            <div>
              <span>Notes</span>
              <strong>{deal.notes.length}</strong>
            </div>
            <div>
              <span>Timeline events</span>
              <strong>{timelineItems.length}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="detail-grid">
        <DetailFieldGrid
          fields={[
            { label: "Value", value: formatMoney(deal.valueCents, deal.currency) },
            { label: "Expected close", value: formatDate(deal.expectedCloseAt) },
            { label: "Pipeline", value: deal.pipeline.name },
            { label: "Stage", value: deal.stage.name },
            { label: "Owner", value: deal.owner?.name ?? "Unassigned" },
            {
              label: "Contact",
              value: deal.person ? (
                <Link className="inline-link" href={`/contacts/${deal.person.id}`}>
                  {formatPersonName(deal.person)}
                </Link>
              ) : (
                "None"
              )
            },
            {
              label: "Organization",
              value: deal.organization ? (
                <Link className="inline-link" href={`/organizations/${deal.organization.id}`}>
                  {deal.organization.name}
                </Link>
              ) : (
                "None"
              )
            }
          ]}
        />
        <div className="data-card">
          <h2 className="panel-title">Stage Movement</h2>
          {deal.status === "OPEN" ? (
            <DealStageMoveForm
              currentStageId={deal.stageId}
              dealId={deal.id}
              pipelineId={deal.pipelineId}
              stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
              workspaceId={workspace.id}
            />
          ) : (
            <p className="empty-copy">Stage movement is locked after a deal is closed.</p>
          )}
        </div>
      </section>

      <ContractWorkflowPanel fields={contractFields} />

      <DealLineItemsPanel
        dealId={deal.id}
        lineItems={deal.lineItems}
        products={products.filter((product) => product.active)}
        workspaceId={workspace.id}
      />

      <QuoteDraftsPanel
        canCreate={deal.lineItems.length > 0}
        dealId={deal.id}
        quotes={deal.quotes}
        workspaceId={workspace.id}
      />

      <section className="data-card" style={{ marginTop: 14 }}>
        <h2 className="panel-title">Custom Fields</h2>
        <DealCustomFieldsForm
          dealId={deal.id}
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
        <h2 className="panel-title">Deal Outcome</h2>
        <DealCloseActions dealId={deal.id} status={deal.status} workspaceId={workspace.id} />
      </section>

      <RecordActivitiesPanel
        attachment={{ dealId: deal.id }}
        defaultOwnerId={actorUserId}
        formId="add-activity"
        owners={owners}
        sections={[
          {
            activities: openActivities,
            emptyMessage: "No open activities are attached to this deal.",
            showCompleteAction: true,
            title: "Open Next Steps"
          },
          {
            activities: completedActivities,
            emptyMessage: "Completed activities will appear here.",
            title: "Completed Activity History"
          }
        ]}
        workspaceId={workspace.id}
      />

      <NotesPanel
        attachment={{ dealId: deal.id }}
        emptyMessage="No notes have been added to this deal."
        notes={deal.notes}
        workspaceId={workspace.id}
      />

      <ManualEmailLogPanel
        attachment={{ dealId: deal.id }}
        templates={emailTemplates}
        workspaceId={workspace.id}
      />

      <RecordTimeline emptyMessage="No deal timeline activity yet." items={timelineItems} title="Deal Timeline" />

      <AuditHistoryPanel
        emptyMessage="No audit events have been recorded for this deal yet."
        entries={deal.auditLogs}
      />
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function DealNextStepCard({
  activity,
  attention
}: {
  activity?: {
    id: string;
    title: string;
    type: string;
    dueAt: Date | string | null;
    completedAt: Date | string | null;
    owner?: { name: string | null; email: string } | null;
  };
  attention: DealAttentionBucket;
}) {
  return (
    <div className="data-card deal-next-step-card">
      <div className="deal-context-heading">
        <h2 className="panel-title">Next Step</h2>
        <span className={`deal-attention deal-attention-${attention}`}>{dealAttentionLabel(attention)}</span>
      </div>
      {activity ? (
        <>
          <strong>{activity.title}</strong>
          <div className="deal-meta">
            <span>{formatActivityType(activity.type)}</span>
            <ActivityDueBadge activity={activity} />
            <span>{activity.owner?.name ?? activity.owner?.email ?? "Unassigned"}</span>
          </div>
          <Link className="inline-link" href={`/activities/${activity.id}/edit`}>
            Edit activity
          </Link>
        </>
      ) : (
        <>
          <p className="empty-copy">No open activity is attached to this deal.</p>
          <Link className="button-secondary button-compact" href="#add-activity">
            Add next activity
          </Link>
        </>
      )}
    </div>
  );
}

function compareOpenActivities(
  a: { dueAt: Date | string | null; createdAt: Date | string },
  b: { dueAt: Date | string | null; createdAt: Date | string }
) {
  const aDue = toTime(a.dueAt);
  const bDue = toTime(b.dueAt);
  if (aDue !== bDue) return aDue - bDue;
  return toTime(a.createdAt) - toTime(b.createdAt);
}

function compareCompletedActivities(
  a: { completedAt: Date | string | null; createdAt: Date | string },
  b: { completedAt: Date | string | null; createdAt: Date | string }
) {
  const aCompleted = toTime(a.completedAt);
  const bCompleted = toTime(b.completedAt);
  if (aCompleted !== bCompleted) return bCompleted - aCompleted;
  return toTime(b.createdAt) - toTime(a.createdAt);
}

function toTime(value: Date | string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  return new Date(value).getTime();
}
