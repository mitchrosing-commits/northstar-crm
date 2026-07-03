import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";

import { ApiError } from "@/lib/api/responses";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { AppShell } from "@/components/app-shell";
import { AttentionBadge } from "@/components/attention-badge";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { Badge } from "@/components/badge";
import { DealCommercialSummaryPanel } from "@/components/commercial-workflow-panel";
import { ContractWorkflowPanel, ContractWorkflowQuickLink } from "@/components/contract-workflow-panel";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { DealCloseActions } from "@/components/deal-close-actions";
import { DealLineItemsPanel } from "@/components/deal-line-items-panel";
import { DealStageMoveForm } from "@/components/deal-stage-move-form";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { EmptyState } from "@/components/empty-state";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { formatActivityType, formatDate, formatMoney } from "@/components/format";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { NotesPanel } from "@/components/notes-panel";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { QuoteDraftsPanel } from "@/components/quote-drafts-panel";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { RecordNextActivitySummary } from "@/components/record-next-activity-summary";
import { RecordHeaderActions } from "@/components/record-header-actions";
import { RecordPanelJumpNav } from "@/components/record-panel-jump-nav";
import { RecordSummary, type RecordSummaryTone } from "@/components/record-summary";
import { RecordTimeline } from "@/components/record-timeline";
import { StatusBadge } from "@/components/status-badge";
import { createDealAutomationActivityAction } from "@/app/deals/actions";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { compareActivitiesForNextStep } from "@/lib/activity-workflow";
import { summarizeDealCommercialReadiness } from "@/lib/commercial-workflow";
import { classifyDealAttention, dealAttentionLabel, type DealAttentionBucket } from "@/lib/deal-attention";
import { recordActivitySectionCopy } from "@/lib/record-activity-copy";
import { closedDealLockedLabel, closedDealLockMessage } from "@/lib/record-lock-copy";
import { formatPersonName } from "@/lib/person-name";
import { recordSubtitle } from "@/lib/record-subtitle";
import { buildDealAttentionBadges, type DealAttentionBadge } from "@/lib/sales-assistant";
import { getDeal, getRecordTimeline, getWorkspace, listDealContractSteps, listDealCustomFields, listEmailLogsForRecord, listEmailTemplates, listProducts, listStages, type AutomationTemplateId } from "@/lib/services/crm";

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
  const [stages, workspaceDetail, customFields, contractSteps, timelineItems, products, emailTemplates, emailLogs] = await Promise.all([
    listStages(actor, deal.pipelineId),
    getWorkspace(actor),
    listDealCustomFields(actor, deal.id),
    listDealContractSteps(actor, deal.id),
    getRecordTimeline(actor, { type: "DEAL", id: deal.id }),
    listProducts(actor),
    listEmailTemplates(actor, { activeOnly: true }),
    listEmailLogsForRecord(actor, { type: "DEAL", id: deal.id })
  ]);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const openActivities = deal.activities.filter((activity) => !activity.completedAt).sort(compareActivitiesForNextStep);
  const completedActivities = deal.activities.filter((activity) => activity.completedAt).sort(compareCompletedActivities);
  const openActivityCopy = recordActivitySectionCopy("dealOpen");
  const completedActivityCopy = recordActivitySectionCopy("dealCompleted");
  const nextActivity = openActivities[0];
  const attention = classifyDealAttention({ activities: nextActivity ? [nextActivity] : [] });
  const contractFields = customFields.map((field) => ({
    key: field.key,
    name: field.name,
    value: field.values[0]?.value ?? null
  }));
  const contractAttentionFields =
    contractSteps.length > 0
      ? contractSteps.map((step) => ({
          key: `${step.type.toLowerCase()}_status`,
          name: `${step.type} Status`,
          value: contractStatusForAttention(step.status)
        }))
      : contractFields;
  const attentionBadges = buildDealAttentionBadges({
    ...deal,
    activities: openActivities,
    contractFields: contractAttentionFields,
    emailLogs,
    notes: deal.notes,
    quotes: deal.quotes
  });
  const automationSuggestions = buildDealAutomationSuggestions({
    contractFields: contractAttentionFields,
    contractSteps,
    deal,
    hasNextActivity: Boolean(nextActivity)
  });
  const commercialSummary = summarizeDealCommercialReadiness({
    ...deal,
    contractSteps
  });

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <RecordHeaderActions
            addHref={"#add-activity" as Route}
            addLabel="Add next activity"
            addLockedLabel="Activity locked"
            backHref="/deals"
            backLabel="Back to deals"
            customFieldsHref={"#custom-fields" as Route}
            editHref={deal.status === "OPEN" ? (`/deals/${deal.id}/edit` as Route) : undefined}
            editLabel="Edit deal"
            lockedLabel={closedDealLockedLabel}
            noteHref={"#notes" as Route}
            noteLockedLabel="Notes locked"
            leadingActions={
              <>
                <ContractWorkflowQuickLink alwaysShow fields={contractFields} steps={contractSteps} />
                <StatusBadge status={deal.status} />
              </>
            }
            locked={deal.status !== "OPEN"}
            recordTitle={deal.title}
          />
        }
        eyebrow="Deal"
        subtitle={recordSubtitle([deal.stage.name, formatMoney(deal.valueCents, deal.currency), deal.organization?.name ?? formatPersonName(deal.person)])}
        title={deal.title}
      />

      <RecordSummary
        actions={
          <RecordPanelJumpNav
            counts={{
              activities: deal.activities.length,
              auditHistory: deal.auditLogs.length,
              customFields: customFields.length,
              emailLog: emailLogs.length,
              notes: deal.notes.length,
              timeline: timelineItems.length
            }}
            extraJumps={[
              {
                href: "#contract-workflow" as Route,
                label: "Contract",
                count: contractSteps.length,
                countLabel: { singular: "contract step", plural: "contract steps" }
              },
              {
                href: "#line-items" as Route,
                label: "Line items",
                count: deal.lineItems.length,
                countLabel: { singular: "line item", plural: "line items" }
              },
              {
                href: "#quotes" as Route,
                label: "Quotes",
                count: deal.quotes.length,
                countLabel: { singular: "quote", plural: "quotes" }
              }
            ]}
          />
        }
        description={`${deal.pipeline.name} pipeline · Expected close ${formatDate(deal.expectedCloseAt)}`}
        eyebrow="Deal snapshot"
        items={[
          { label: "Status", value: <StatusBadge status={deal.status} />, tone: getDealStatusTone(deal.status) },
          { label: "Value", value: formatMoney(deal.valueCents, deal.currency) },
          { label: "Stage", value: deal.stage.name },
          {
            label: "Next follow-up",
            value: <RecordNextActivitySummary activity={nextActivity} emptyBadgeLabel={deal.status === "OPEN" ? "Needs follow-up" : undefined} emptyLabel="No open deal follow-up" />,
            tone: nextActivity ? "default" : "warning"
          },
          {
            label: "Customer",
            value: deal.organization ? (
              <Link className="inline-link" href={`/organizations/${deal.organization.id}`}>
                {deal.organization.name}
              </Link>
            ) : deal.person ? (
              <Link className="inline-link" href={`/contacts/${deal.person.id}`}>
                {formatPersonName(deal.person) ?? "Unnamed contact"}
              </Link>
            ) : (
              <InlineEmptyStateText>No customer linked</InlineEmptyStateText>
            ),
            tone: deal.organization || deal.person ? "default" : "muted"
          },
          { label: "Owner", value: deal.owner?.name ?? deal.owner?.email ?? "Unassigned", tone: deal.owner ? "default" : "muted" }
        ]}
        title="Deal workspace"
      />

      <section className="deal-context-grid">
        <DealNextStepCard activity={nextActivity} attention={attention} badges={attentionBadges} dealTitle={deal.title} />
        <div className="data-card">
          <PanelTitleRow title="History Snapshot" />
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
            { label: "Owner", value: deal.owner?.name ?? deal.owner?.email ?? "Unassigned" },
            {
              emptyLabel: "No contact",
              label: "Contact",
              value: deal.person ? (
                <Link className="inline-link" href={`/contacts/${deal.person.id}`}>
                  {formatPersonName(deal.person) ?? "Unnamed contact"}
                </Link>
              ) : (
                null
              )
            },
            {
              emptyLabel: "No organization",
              label: "Organization",
              value: deal.organization ? (
                <Link className="inline-link" href={`/organizations/${deal.organization.id}`}>
                  {deal.organization.name}
                </Link>
              ) : (
                null
              )
            }
          ]}
        />
        <div className="data-card">
          <PanelTitleRow title="Stage Movement" />
          {deal.status === "OPEN" ? (
            <DealStageMoveForm
              currentStageId={deal.stageId}
              dealId={deal.id}
              pipelineId={deal.pipelineId}
              stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
              workspaceId={workspace.id}
            />
          ) : (
            <LockedPanelNotice title="Stage locked">{closedDealLockMessage("stage")}</LockedPanelNotice>
          )}
        </div>
      </section>

      <DealCommercialSummaryPanel dealId={deal.id} summary={commercialSummary} />

      <ContractWorkflowPanel
        dealId={deal.id}
        fields={contractFields}
        lockedMessage={closedDealLockMessage("contractWorkflow")}
        owners={owners}
        readOnly={deal.status !== "OPEN"}
        steps={contractSteps}
        workspaceId={workspace.id}
      />

      <DealLineItemsPanel
        canEdit={deal.status === "OPEN"}
        dealId={deal.id}
        lineItems={deal.lineItems}
        products={products.filter((product) => product.active)}
        workspaceId={workspace.id}
      />

      <QuoteDraftsPanel
        canCreate={deal.status === "OPEN" && deal.lineItems.length > 0}
        dealId={deal.id}
        disabledReason={deal.status === "OPEN" ? undefined : closedDealLockMessage("quoteDrafts")}
        quotes={deal.quotes}
        workspaceId={workspace.id}
      />

      <RecordCustomFieldsPanel
        emptyMessage="No deal custom fields have been created yet."
        entityId={deal.id}
        entityType="DEAL"
        fields={customFields}
        lockedMessage={closedDealLockMessage("customFields")}
        readOnly={deal.status !== "OPEN"}
        workspaceId={workspace.id}
      />

      <section className="data-card section-spaced">
        <PanelTitleRow title="Deal Outcome" />
        <DealCloseActions dealId={deal.id} status={deal.status} workspaceId={workspace.id} />
      </section>

      <RecordActivitiesPanel
        attachment={{ dealId: deal.id }}
        defaultOwnerId={actorUserId}
        formId="add-activity"
        lockedMessage={closedDealLockMessage("activities")}
        owners={owners}
        sections={[
          {
            activities: openActivities,
            description: openActivityCopy.description,
            emptyMessage: openActivityCopy.emptyMessage,
            showCompleteAction: deal.status === "OPEN",
            title: openActivityCopy.title
          },
          {
            activities: completedActivities,
            description: completedActivityCopy.description,
            emptyMessage: completedActivityCopy.emptyMessage,
            title: completedActivityCopy.title
          }
        ]}
        showForm={deal.status === "OPEN"}
        workspaceId={workspace.id}
      />

      <NotesPanel
        attachment={{ dealId: deal.id }}
        emptyMessage="No notes have been added to this deal."
        lockedMessage={closedDealLockMessage("notes")}
        notes={deal.notes}
        showDeleteActions={deal.status === "OPEN"}
        showForm={deal.status === "OPEN"}
        workspaceId={workspace.id}
      />

      <ManualEmailLogPanel
        attachment={{ dealId: deal.id }}
        lockedMessage={closedDealLockMessage("emailLogs")}
        showForm={deal.status === "OPEN"}
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

function getDealStatusTone(status: string): RecordSummaryTone {
  if (status === "WON") return "success";
  if (status === "LOST") return "danger";
  return "default";
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
    <section className="data-card automation-template-panel section-separated">
      <PanelTitleRow
        actions={<Badge>Creates activities</Badge>}
        eyebrow="Suggested Automations"
        title="One-click next actions"
      />
      <FormIntroCallout title="Suggested next steps">
        These templates create follow-up activities now. They are not background automations or a rule builder.
      </FormIntroCallout>
      <div className="automation-template-list">
        {suggestions.map((suggestion) => {
          const automationActionLabel = `${suggestion.actionLabel}: create ${suggestion.title.toLowerCase()} activity`;

          return (
            <form action={createDealAutomationActivityAction} className="automation-template-item" key={suggestion.templateId}>
              <input name="dealId" type="hidden" value={dealId} />
              <input name="templateId" type="hidden" value={suggestion.templateId} />
              <div>
                <strong>{suggestion.title}</strong>
                <p>{suggestion.description}</p>
              </div>
              <button
                aria-label={automationActionLabel}
                className="button-secondary button-compact"
                title={automationActionLabel}
                type="submit"
              >
                {suggestion.actionLabel}
              </button>
            </form>
          );
        })}
      </div>
    </section>
  );
}

function buildDealAutomationSuggestions({
  contractFields,
  contractSteps,
  deal,
  hasNextActivity
}: {
  contractFields: Array<{ key: string; name: string; value: unknown }>;
  contractSteps: Array<{ status: string }>;
  deal: {
    status: string;
    stage: { name: string };
    quotes: Array<{ status: string }>;
  };
  hasNextActivity: boolean;
}): DealAutomationSuggestion[] {
  const suggestions: DealAutomationSuggestion[] = [];
  const hasContractAttention =
    contractSteps.some((step) => ["SENT", "IN_PROGRESS", "BLOCKED"].includes(step.status)) ||
    contractFields.some((field) =>
      ["sent", "in review", "in progress", "blocked"].includes(String(field.value ?? "").trim().toLowerCase())
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

function contractStatusForAttention(status: string) {
  if (status === "IN_PROGRESS") return "In progress";
  if (status === "SENT") return "Sent";
  if (status === "BLOCKED") return "Blocked";
  if (status === "SIGNED") return "Signed";
  if (status === "SKIPPED") return "Skipped";
  return "Not started";
}

function DealNextStepCard({
  activity,
  attention,
  badges,
  dealTitle
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
  dealTitle: string;
}) {
  const supportingBadges = badges.filter((badge) => badge.kind !== "overdue" && badge.kind !== "no-next-activity").slice(0, 4);
  const addNextActivityActionLabel = `Add next activity for ${dealTitle}`;
  return (
    <div className="data-card deal-next-step-card">
      <PanelTitleRow
        actions={
          <AttentionBadge classNamePrefix="deal-attention" tone={attention}>
            {dealAttentionLabel(attention)}
          </AttentionBadge>
        }
        title="Next Step"
      />
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
        <EmptyState
          actions={
            <Link
              aria-label={addNextActivityActionLabel}
              className="button-secondary button-compact"
              href="#add-activity"
              title={addNextActivityActionLabel}
            >
              Add next activity
            </Link>
          }
          className="empty-state-compact empty-state-panel deal-next-step-empty"
          title="No open activity is attached to this deal."
        />
      )}
      {supportingBadges.length > 0 ? (
        <div className="deal-next-step-cues">
          {supportingBadges.map((badge) => (
            <AttentionBadge classNamePrefix="deal-attention-badge" key={badge.kind} tone={badge.kind}>
              {badge.label}
            </AttentionBadge>
          ))}
        </div>
      ) : null}
      {supportingBadges.some((badge) => badge.kind === "email-follow-up") ? (
        <FormIntroCallout className="deal-next-step-cue" title="Email follow-up">
          A recent inbound email is linked to this deal. Add a follow-up so it does not get buried.
        </FormIntroCallout>
      ) : null}
      {supportingBadges.some((badge) => badge.kind === "quote-waiting") ? (
        <FormIntroCallout className="deal-next-step-cue" title="Quote follow-up">
          A sent quote is waiting for a response. Review the quote or schedule a follow-up.
        </FormIntroCallout>
      ) : null}
      {supportingBadges.some((badge) => badge.kind === "contract-blocked") ? (
        <Link className="inline-link" href="#contract-workflow">
          Review contract workflow
        </Link>
      ) : null}
    </div>
  );
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
