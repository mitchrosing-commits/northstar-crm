import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { formatMoney } from "@/components/format";
import { ListPageHeaderActions } from "@/components/list-page-header-actions";
import { PageHeader } from "@/components/page-header";
import { PipelineBoard } from "@/components/pipeline-board";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listCustomFieldSummaries, listDealContractStepsForDeals, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const pipelines = await listPipelines(actor);
  const basePipeline = pipelines[0];
  const dealExportCount = pipelines.reduce(
    (count, pipeline) => count + pipeline.stages.reduce((stageCount, stage) => stageCount + stage.deals.length, 0),
    0
  );
  const dealIds = basePipeline?.stages.flatMap((stage) => stage.deals.map((deal) => deal.id)) ?? [];
  const [customFieldSummaries, contractStepSummaries] = await Promise.all([
    listCustomFieldSummaries(actor, "DEAL", dealIds),
    listDealContractStepsForDeals(actor, dealIds)
  ]);
  const pipeline = basePipeline
    ? {
        ...basePipeline,
        stages: basePipeline.stages.map((stage) => ({
          ...stage,
          deals: stage.deals.map((deal) => ({
            ...deal,
            contractFields: customFieldSummaries.get(deal.id) ?? [],
            contractSteps: contractStepSummaries.get(deal.id) ?? []
          }))
        }))
      }
    : null;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          pipeline ? (
            <ListPageHeaderActions
              createHref="/deals/new"
              createLabel="New deal"
              importHref="/settings/import-export#deals-import"
              matchingCount={dealExportCount}
              resource="deals"
              searchParams={{}}
              workspaceId={workspace.id}
            />
          ) : null
        }
        eyebrow="Pipeline"
        subtitle={pipeline ? "Open a deal to update stage, activities, notes, and quotes, or use Move on a card." : undefined}
        title={pipeline?.name ?? "Pipeline"}
      />
      {pipeline ? (
        <>
          <PipelineSummary pipeline={pipeline} />
          <PipelineBoard pipeline={pipeline} workspaceId={workspace.id} />
        </>
      ) : (
        <EmptyState
          description="New workspaces include a default sales pipeline. Ask a workspace admin to restore or create one before adding deals."
          title="No pipeline yet"
          titleLevel="h2"
        />
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
