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
import { createDealAutomationActivityAction } from "@/app/deals/actions";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { classifyDealAttention, dealAttentionLabel, type DealAttentionBucket } from "@/lib/deal-attention";
import { buildDealAttentionBadges, type DealAttentionBadge } from "@/lib/sales-assistant";
import { getDeal, getRecordTimeline, getWorkspace, listDealCustomFields, listEmailLogsForRecord, listEmailTemplates, listProducts, listStages, type AutomationTemplateId } from "@/lib/services/crm";

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
  const [stages, workspaceDetail, customFields, timelineItems, products, emailTemplates, emailLogs] = await Promise.all([
    listStages(actor, deal.pipelineId),
    getWorkspace(actor),
    listDealCustomFields(actor, deal.id),
    getRecordTimeline(actor, { type: "DEAL", id: deal.id }),
    listProducts(actor),
    listEmailTemplates(actor, { activeOnly: true }),
    listEmailLogsForRecord(actor, { type: "DEAL", id: deal.id })
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
  const attentionBadges = buildDealAttentionBadges({
    ...deal,
    activities: openActivities,
    contractFields,
    emailLogs,
    notes: deal.notes,
    quotes: deal.quotes
  });
  const automationSuggestions = buildDealAutomationSuggestions({
    contractFields,
    deal,
    hasNextActivity: Boolean(nextActivity)
  });

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
        <DealNextStepCard activity={nextActivity} attention={attention} badges={attentionBadges} />
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

      <DealAutomationTemplatesPanel dealId={deal.id} suggestions={automationSuggestions} />

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

      <ContractWorkflowPanel dealId={deal.id} fields={contractFields} />

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

type DealAutomationSuggestion = {
  templateId: AutomationTemplateId;
  title: string;
  description: string;
  actionLabel: string;
};

function DealAutomationTemplatesPanel({
  dealId,
  suggestions
}: {
  dealId: string;
  suggestions: DealAutomationSuggestion[];
}) {
  if (suggestions.length === 0) return null;

  return (
    <section className="data-card automation-template-panel" style={{ marginBottom: 14 }}>
      <div className="panel-title-row">
        <div>
          <p className="page-kicker">Suggested Automations</p>
          <h2 className="panel-title">One-click next actions</h2>
        </div>
        <span className="badge">Creates activities</span>
      </div>
      <p className="empty-copy">
        These templates create follow-up activities now. They are not background automations or a rule builder.
      </p>
      <div className="automation-template-list">
        {suggestions.map((suggestion) => (
          <form action={createDealAutomationActivityAction} className="automation-template-item" key={suggestion.templateId}>
            <input name="dealId" type="hidden" value={dealId} />
            <input name="templateId" type="hidden" value={suggestion.templateId} />
            <div>
              <strong>{suggestion.title}</strong>
              <p>{suggestion.description}</p>
            </div>
            <button className="button-secondary button-compact" type="submit">
              {suggestion.actionLabel}
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}

function buildDealAutomationSuggestions({
  contractFields,
  deal,
  hasNextActivity
}: {
  contractFields: Array<{ key: string; name: string; value: unknown }>;
  deal: {
    status: string;
    stage: { name: string };
    quotes: Array<{ status: string }>;
  };
  hasNextActivity: boolean;
}): DealAutomationSuggestion[] {
  const suggestions: DealAutomationSuggestion[] = [];
  const hasContractAttention = contractFields.some((field) =>
    ["sent", "in review", "blocked"].includes(String(field.value ?? "").trim().toLowerCase())
  );

  if (deal.status === "OPEN" && !hasNextActivity) {
    suggestions.push({
      templateId: "deal-next-activity",
      title: "Create next activity",
      description: "Add a next step so this open deal does not go quiet.",
      actionLabel: "Add follow-up"
    });
  }
  if (deal.status === "OPEN" && deal.stage.name.toLowerCase().includes("proposal")) {
    suggestions.push({
      templateId: "deal-proposal-follow-up",
      title: "Proposal follow-up",
      description: "Schedule a follow-up three days after a proposal-stage deal.",
      actionLabel: "Create activity"
    });
  }
  if (deal.status === "OPEN" && deal.quotes.some((quote) => quote.status === "SENT")) {
    suggestions.push({
      templateId: "quote-follow-up",
      title: "Quote follow-up",
      description: "Create a customer check-in for a sent quote.",
      actionLabel: "Create activity"
    });
  }
  if (deal.status === "OPEN" && hasContractAttention) {
    suggestions.push({
      templateId: "contract-follow-up",
      title: "Contract follow-up",
      description: "Create a task to unblock NDA, MSA, or SOW progress.",
      actionLabel: "Create task"
    });
  }
  if (deal.status === "WON") {
    suggestions.push({
      templateId: "post-sale-handoff",
      title: "Post-sale handoff",
      description: "Create an onboarding handoff task linked to this won deal.",
      actionLabel: "Create task"
    });
  }
  if (deal.status === "LOST") {
    suggestions.push({
      templateId: "lost-reengagement",
      title: "Future re-engagement",
      description: "Create a future reminder to revisit this lost opportunity.",
      actionLabel: "Create reminder"
    });
  }

  return suggestions;
}

function DealNextStepCard({
  activity,
  attention,
  badges
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
  badges: DealAttentionBadge[];
}) {
  const supportingBadges = badges.filter((badge) => badge.kind !== "overdue" && badge.kind !== "no-next-activity").slice(0, 4);
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
      {supportingBadges.length > 0 ? (
        <div className="deal-next-step-cues">
          {supportingBadges.map((badge) => (
            <span className={`deal-attention-badge deal-attention-badge-${badge.kind}`} key={badge.kind}>
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
      {supportingBadges.some((badge) => badge.kind === "email-follow-up") ? (
        <p className="empty-copy">A recent inbound email is linked to this deal. Add a follow-up so it does not get buried.</p>
      ) : null}
      {supportingBadges.some((badge) => badge.kind === "quote-waiting") ? (
        <p className="empty-copy">A sent quote is waiting for a response. Review the quote or schedule a follow-up.</p>
      ) : null}
      {supportingBadges.some((badge) => badge.kind === "contract-blocked") ? (
        <Link className="inline-link" href="#contract-workflow">
          Review contract workflow
        </Link>
      ) : null}
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
