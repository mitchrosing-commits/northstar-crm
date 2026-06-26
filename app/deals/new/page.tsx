import { AppShell } from "@/components/app-shell";
import { DealForm } from "@/components/deal-form";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace, listOrganizations, listPeople, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewDealPage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [pipelines, people, organizations, workspaceDetail] = await Promise.all([
    listPipelines(actor),
    listPeople(actor),
    listOrganizations(actor),
    getWorkspace(actor)
  ]);

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Deal</p>
          <h1 className="page-title">New deal</h1>
        </div>
      </header>
      <DealForm
        defaultOwnerId={actorUserId}
        mode="create"
        organizations={organizations.map((organization) => ({ id: organization.id, name: organization.name }))}
        owners={workspaceDetail.memberships.map((membership) => ({
          id: membership.user.id,
          name: membership.user.name ?? membership.user.email
        }))}
        people={people.map((person) => ({ id: person.id, name: [person.firstName, person.lastName].filter(Boolean).join(" ") }))}
        stages={pipelines.flatMap((pipeline) =>
          pipeline.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            pipelineId: pipeline.id,
            pipelineName: pipeline.name
          }))
        )}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}
