import { AppShell } from "@/components/app-shell";
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
        <PipelineBoard pipeline={pipeline} workspaceId={workspace.id} />
      ) : (
        <div className="empty-state">
          <h2>No pipeline yet</h2>
          <p>New workspaces include a default sales pipeline. Ask a workspace admin to restore or create one before adding deals.</p>
        </div>
      )}
    </AppShell>
  );
}
