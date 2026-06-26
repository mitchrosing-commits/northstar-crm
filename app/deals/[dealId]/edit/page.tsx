import { notFound } from "next/navigation";
import Link from "next/link";

import { ApiError } from "@/lib/api/responses";
import { AppShell } from "@/components/app-shell";
import { DealForm } from "@/components/deal-form";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getDeal, getWorkspace, listOrganizations, listPeople, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string }>;
};

export default async function EditDealPage({ params }: PageProps) {
  const { dealId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [deal, pipelines, people, organizations, workspaceDetail] = await Promise.all([
    getDeal(actor, dealId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
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
          <h1 className="page-title">Edit deal</h1>
        </div>
      </header>
      {deal.status === "OPEN" ? (
        <DealForm
          initialDeal={{
            id: deal.id,
            title: deal.title,
            valueCents: deal.valueCents,
            currency: deal.currency,
            status: deal.status,
            expectedCloseAt: deal.expectedCloseAt,
            stageId: deal.stageId,
            personId: deal.personId,
            organizationId: deal.organizationId,
            ownerId: deal.ownerId
          }}
          mode="edit"
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
      ) : (
        <section className="empty-state">
          <h2>Closed deals are locked</h2>
          <p>Edit fields are disabled after a deal is marked won or lost.</p>
          <Link className="text-link" href={`/deals/${deal.id}`}>
            Back to deal
          </Link>
        </section>
      )}
    </AppShell>
  );
}
