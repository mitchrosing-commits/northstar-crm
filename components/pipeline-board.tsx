import Link from "next/link";

import { ContractWorkflowSummary } from "@/components/contract-workflow-panel";
import { formatDate, formatMoney } from "@/components/format";
import { PipelineStageMoveControl } from "@/components/pipeline-stage-move-control";
import { StatusBadge } from "@/components/status-badge";

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
      activities?: Array<{
        id: string;
        title: string;
        type: string;
        dueAt: Date | string | null;
      }>;
      contractFields?: Array<{
        key: string;
        name: string;
        value: unknown;
      }>;
    }>;
  }>;
};

export function PipelineBoard({ pipeline, workspaceId }: { pipeline: Pipeline; workspaceId: string }) {
  const stages = pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }));
  const dealCount = pipeline.stages.reduce((sum, stage) => sum + stage.deals.length, 0);

  return (
    <>
      {dealCount === 0 ? (
        <div className="pipeline-ready-panel">
          <strong>Your stages are ready.</strong>
          <span>Create your first deal to start moving opportunities through this board.</span>
          <Link className="button-secondary button-compact" href="/deals/new">
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
                <h2 className="stage-title">{stage.name}</h2>
                <span className="stage-total">{formatMoney(stageTotal)}</span>
              </div>
              <div className="deal-stack">
                {stage.deals.map((deal) => {
                  const isClosed = deal.status !== "OPEN";
                  return (
                    <article className={isClosed ? "deal-card deal-card-closed" : "deal-card"} key={deal.id}>
                      <Link aria-label={`Open deal ${deal.title}`} className="deal-card-link" href={`/deals/${deal.id}`}>
                        <div className="deal-card-header">
                          <p className="deal-card-title">{deal.title}</p>
                          <StatusBadge status={deal.status} />
                        </div>
                        <div className="deal-meta">
                          <span>{formatMoney(deal.valueCents, deal.currency)}</span>
                          {deal.organization ? <span>{deal.organization.name}</span> : null}
                          {deal.person ? <span>{formatPersonName(deal.person)}</span> : null}
                        </div>
                        <ContractWorkflowSummary fields={deal.contractFields ?? []} />
                        <div className="deal-card-detail">
                          <span>Owner</span>
                          <strong>{deal.owner?.name ?? deal.owner?.email ?? "Unassigned"}</strong>
                        </div>
                        <div className="deal-card-detail">
                          <span>Next</span>
                          <strong>{isClosed ? "Closed" : formatNextActivity(deal.activities?.[0])}</strong>
                        </div>
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

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function formatNextActivity(activity?: { title: string; type: string; dueAt: Date | string | null }) {
  if (!activity) return "No activity";
  return `${activity.title} · ${formatDate(activity.dueAt)}`;
}
