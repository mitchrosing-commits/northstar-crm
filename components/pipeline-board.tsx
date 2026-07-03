import Link from "next/link";

import { AttentionBadge } from "@/components/attention-badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { ContractWorkflowSummary } from "@/components/contract-workflow-panel";
import { formatDate, formatMoney } from "@/components/format";
import { PipelineStageMoveControl } from "@/components/pipeline-stage-move-control";
import { StatusBadge } from "@/components/status-badge";
import { formatPersonName } from "@/lib/person-name";
import { buildDealAttentionBadges } from "@/lib/sales-assistant";

type Pipeline = {
  id: string;
  stages: Array<{
    id: string;
    name: string;
    probability: number | null;
    deals: Array<{
      id: string;
      pipelineId: string;
      stageId: string;
      title: string;
      valueCents: number | null;
      currency: string;
      status: string;
      owner?: { name: string | null; email: string } | null;
      organization?: { name: string } | null;
      person?: { firstName: string; lastName: string | null } | null;
      updatedAt?: Date | string | null;
      expectedCloseAt?: Date | string | null;
      activities?: Array<{
        id: string;
        title: string;
        type: string;
        dueAt: Date | string | null;
        completedAt?: Date | string | null;
        createdAt?: Date | string | null;
      }>;
      notes?: Array<{
        createdAt: Date | string | null;
      }>;
      emailLogs?: Array<{
        direction: string;
        occurredAt: Date | string | null;
      }>;
      quotes?: Array<{
        number?: string;
        status: string;
        totalCents?: number;
        currency?: string;
        createdAt: Date | string | null;
        updatedAt: Date | string | null;
      }>;
      contractFields?: Array<{
        key: string;
        name: string;
        value: unknown;
      }>;
      contractSteps?: Array<{
        id: string;
        type: "NDA" | "MSA" | "SOW";
        status: "NOT_STARTED" | "IN_PROGRESS" | "SENT" | "SIGNED" | "BLOCKED" | "SKIPPED";
        ownerId: string | null;
        owner?: { name: string | null; email: string } | null;
        dueAt: Date | string | null;
        sentAt: Date | string | null;
        signedAt: Date | string | null;
        notes: string | null;
        externalReference: string | null;
      }>;
    }>;
  }>;
};

export function PipelineBoard({ pipeline, workspaceId }: { pipeline: Pipeline; workspaceId: string }) {
  const stages = pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }));
  const dealCount = pipeline.stages.reduce((sum, stage) => sum + stage.deals.length, 0);
  const createDealLabel = "Create the first pipeline deal";

  return (
    <>
      {dealCount === 0 ? (
        <div className="pipeline-ready-panel">
          <strong>Your stages are ready.</strong>
          <span>Create your first deal to start moving opportunities through this board.</span>
          <Link
            aria-label={createDealLabel}
            className="button-secondary button-compact"
            href="/deals/new"
            title={createDealLabel}
          >
            Create deal
          </Link>
        </div>
      ) : null}
      <div className="kanban" aria-label="Pipeline board">
        {pipeline.stages.map((stage) => {
          const stageTotal = stage.deals.reduce((sum, deal) => sum + (deal.valueCents ?? 0), 0);
          return (
            <section className="stage-column" key={stage.id}>
              <div className="stage-header">
                <div>
                  <h2 className="stage-title">{stage.name}</h2>
                  <p className="stage-meta">
                    {stage.deals.length} {stage.deals.length === 1 ? "deal" : "deals"}
                    {stage.probability == null ? "" : ` · ${stage.probability}% probability`}
                  </p>
                </div>
                <span className="stage-total">{formatMoney(stageTotal)}</span>
              </div>
              <div className="deal-stack">
                {stage.deals.map((deal) => {
                  const isClosed = deal.status !== "OPEN";
                  const attentionBadges = buildDealAttentionBadges(deal).slice(0, 3);
                  const openDealLabel = `Open deal ${deal.title}`;
                  const attentionSignalsLabel = `${deal.title} attention signals`;
                  return (
                    <article className={isClosed ? "deal-card deal-card-closed" : "deal-card"} key={deal.id}>
                      <Link
                        aria-label={openDealLabel}
                        className="deal-card-link"
                        href={`/deals/${deal.id}`}
                        title={openDealLabel}
                      >
                        <CompactTitleRow actions={<StatusBadge status={deal.status} />} title={deal.title} />
                        <div className="deal-meta">
                          <span>{formatMoney(deal.valueCents, deal.currency)}</span>
                          {deal.organization ? <span>{deal.organization.name}</span> : null}
                          {deal.person ? <span>{formatPersonName(deal.person) ?? "Unnamed contact"}</span> : null}
                        </div>
                        {attentionBadges.length > 0 ? (
                          <div className="deal-card-badges" aria-label={attentionSignalsLabel} title={attentionSignalsLabel}>
                            {attentionBadges.map((badge) => (
                              <AttentionBadge classNamePrefix="deal-attention-badge" key={badge.kind} tone={badge.kind}>
                                {badge.label}
                              </AttentionBadge>
                            ))}
                          </div>
                        ) : null}
                        <ContractWorkflowSummary fields={deal.contractFields ?? []} steps={deal.contractSteps ?? []} />
                        <div className="deal-card-detail">
                          <span>Owner</span>
                          <strong>{deal.owner?.name ?? deal.owner?.email ?? "Unassigned"}</strong>
                        </div>
                        <div className="deal-card-detail">
                          <span>Next</span>
                          <strong>{isClosed ? "Closed" : formatNextActivity(deal.activities?.[0])}</strong>
                        </div>
                        {deal.quotes?.[0] ? (
                          <div className="deal-card-detail">
                            <span>Quote</span>
                            <strong>{formatQuoteSignal(deal.quotes[0])}</strong>
                          </div>
                        ) : null}
                        <span className="deal-card-open">Open deal</span>
                      </Link>
                      <PipelineStageMoveControl
                        currentStageId={deal.stageId}
                        dealId={deal.id}
                        dealTitle={deal.title}
                        pipelineId={deal.pipelineId}
                        stages={stages}
                        status={deal.status}
                        workspaceId={workspaceId}
                      />
                    </article>
                  );
                })}
                {stage.deals.length === 0 ? <p className="empty-column">No deals in this stage.</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function formatNextActivity(activity?: { title: string; type: string; dueAt: Date | string | null }) {
  if (!activity) return "No activity";
  return `${activity.title} · ${formatDate(activity.dueAt)}`;
}

function formatQuoteSignal(quote: { number?: string; status: string; totalCents?: number; currency?: string }) {
  const total = quote.totalCents == null ? "" : ` · ${formatMoney(quote.totalCents, quote.currency)}`;
  return `${quote.number ?? quote.status}${total}`;
}
