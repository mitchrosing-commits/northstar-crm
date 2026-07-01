import { AppShell } from "@/components/app-shell";
import { formatMoney } from "@/components/format";
import { PipelineBoard } from "@/components/pipeline-board";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listCustomFieldSummaries, listPipelines } from "@/lib/services/crm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const pipelines = await listPipelines(actor);
  const basePipeline = pipelines[0];
  const dealIds = basePipeline?.stages.flatMap((stage) => stage.deals.map((deal) => deal.id)) ?? [];
  const customFieldSummaries = await listCustomFieldSummaries(actor, "DEAL", dealIds);
  const pipeline = basePipeline
    ? {
        ...basePipeline,
        stages: basePipeline.stages.map((stage) => ({
          ...stage,
          deals: stage.deals.map((deal) => ({
            ...deal,
            contractFields: customFieldSummaries.get(deal.id) ?? []
          }))
        }))
      }
    : null;

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Pipeline</p>
          <h1 className="page-title">{pipeline?.name ?? "Pipeline"}</h1>
          {pipeline ? (
            <p className="page-subtitle">Open a deal to update stage, activities, notes, and quotes, or use Move on a card.</p>
          ) : null}
        </div>
        {pipeline ? (
          <Link className="button-primary" href="/deals/new">
            New deal
          </Link>
        ) : null}
      </header>
      {pipeline ? (
        <>
          <PipelineSummary pipeline={pipeline} />
          <PipelineBoard pipeline={pipeline} workspaceId={workspace.id} />
        </>
      ) : (
        <div className="empty-state">
          <h2>No pipeline yet</h2>
          <p>New workspaces include a default sales pipeline. Ask a workspace admin to restore or create one before adding deals.</p>
        </div>
      )}
    </AppShell>
  );
}

function PipelineSummary({
  pipeline
}: {
  pipeline: {
    stages: Array<{
      deals: Array<{ owner?: unknown | null; status: string; valueCents: number | null }>;
    }>;
  };
}) {
  const openDeals = pipeline.stages.flatMap((stage) => stage.deals).filter((deal) => deal.status === "OPEN");
  const pipelineValue = openDeals.reduce((sum, deal) => sum + (deal.valueCents ?? 0), 0);
  const staffedDeals = openDeals.filter((deal) => deal.owner).length;

  return (
    <section className="pipeline-summary" aria-label="Pipeline summary">
      <div>
        <span>Open value</span>
        <strong>{formatMoney(pipelineValue)}</strong>
      </div>
      <div>
        <span>Open deals</span>
        <strong>{openDeals.length}</strong>
      </div>
      <div>
        <span>Stages</span>
        <strong>{pipeline.stages.length}</strong>
      </div>
      <div>
        <span>Owned deals</span>
        <strong>
          {staffedDeals}/{openDeals.length}
        </strong>
      </div>
    </section>
  );
}
