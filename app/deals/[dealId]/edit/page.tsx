import { notFound } from "next/navigation";
import type { Route } from "next";

import { ApiError } from "@/lib/api/responses";
import { AppShell } from "@/components/app-shell";
import { DealForm } from "@/components/deal-form";
import { FormHeaderActions } from "@/components/form-header-actions";
import { PageHeader } from "@/components/page-header";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { RecordLockedNotice } from "@/components/record-locked-notice";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import { getDeal, getWorkspace, listDealCustomFields, listOrganizations, listPeople, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string }>;
};

export default async function EditDealPage({ params }: PageProps) {
  const { dealId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const deal = await getDeal(actor, dealId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [pipelines, people, organizations, workspaceDetail, customFields] = await Promise.all([
    listPipelines(actor),
    listPeople(actor),
    listOrganizations(actor),
    getWorkspace(actor),
    listDealCustomFields(actor, dealId)
  ]);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <FormHeaderActions
            backHref={`/deals/${deal.id}` as Route}
            backLabel="Back to deal"
            showCustomFieldsLink={deal.status === "OPEN"}
          />
        }
        eyebrow="Deal"
        subtitle="Update core deal fields while custom fields stay grouped below the main form."
        title="Edit deal"
      />
      {deal.status === "OPEN" ? (
        <>
          <DealForm
            cancelHref={`/deals/${deal.id}` as Route}
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
            people={people.map((person) => ({
              id: person.id,
              name: formatPersonName(person) ?? "Unnamed contact"
            }))}
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
          <RecordCustomFieldsPanel
            emptyMessage="No deal custom fields have been created yet."
            entityId={deal.id}
            entityType="DEAL"
            fields={customFields}
            workspaceId={workspace.id}
          />
        </>
      ) : (
        <RecordLockedNotice
          actions={[{ href: `/deals/${deal.id}`, label: "Back to deal" }]}
          title="Closed deals are locked"
        >
          Edit fields are disabled after a deal is marked won or lost.
        </RecordLockedNotice>
      )}
    </AppShell>
  );
}
