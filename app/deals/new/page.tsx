import { AppShell } from "@/components/app-shell";
import { DealForm } from "@/components/deal-form";
import { FormHeaderActions } from "@/components/form-header-actions";
import { PageHeader } from "@/components/page-header";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import { getWorkspace, listOrganizations, listPeople, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewDealPage({
  searchParams
}: {
  searchParams?: Promise<{ organizationId?: string; personId?: string; title?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [pipelines, people, organizations, workspaceDetail] = await Promise.all([
    listPipelines(actor),
    listPeople(actor),
    listOrganizations(actor),
    getWorkspace(actor)
  ]);
  const defaultPersonId = firstSearchParam(resolvedSearchParams?.personId);
  const defaultOrganizationId = firstSearchParam(resolvedSearchParams?.organizationId);
  const defaultTitle = firstSearchParam(resolvedSearchParams?.title);
  const peopleOptions = people.map((person) => ({ id: person.id, name: formatPersonName(person) ?? "Unnamed contact" }));
  const organizationOptions = organizations.map((organization) => ({ id: organization.id, name: organization.name }));
  const hasPrefill = Boolean(defaultTitle || defaultPersonId || defaultOrganizationId);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={<FormHeaderActions backHref="/deals" backLabel="Back to deals" />}
        eyebrow="Deal"
        subtitle="Create a pipeline opportunity with value, stage, owner, and related customer context."
        title="New deal"
      />
      <DealForm
        cancelHref="/deals"
        defaultOwnerId={actorUserId}
        defaultOrganizationId={organizationOptions.some((organization) => organization.id === defaultOrganizationId) ? defaultOrganizationId : undefined}
        defaultPersonId={peopleOptions.some((person) => person.id === defaultPersonId) ? defaultPersonId : undefined}
        defaultTitle={defaultTitle}
        mode="create"
        organizations={organizationOptions}
        owners={workspaceDetail.memberships.map((membership) => ({
          id: membership.user.id,
          name: membership.user.name ?? membership.user.email
        }))}
        people={peopleOptions}
        prefillNotice={
          hasPrefill
            ? "We prefilled this deal from your search or related-record shortcut. Review the details, then create the opportunity."
            : undefined
        }
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

function firstSearchParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.slice(0, 160);
}
