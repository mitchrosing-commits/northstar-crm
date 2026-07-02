import { notFound } from "next/navigation";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { FormHeaderActions } from "@/components/form-header-actions";
import { OrganizationForm } from "@/components/organization-form";
import { PageHeader } from "@/components/page-header";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getOrganization, getWorkspace, listOrganizationCustomFields } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function EditOrganizationPage({ params }: PageProps) {
  const { organizationId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const organization = await getOrganization(actor, organizationId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [workspaceDetail, customFields] = await Promise.all([
    getWorkspace(actor),
    listOrganizationCustomFields(actor, organizationId)
  ]);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <FormHeaderActions
            backHref={`/organizations/${organization.id}` as Route}
            backLabel="Back to organization"
            showCustomFieldsLink
          />
        }
        eyebrow="Organizations"
        subtitle="Maintain company ownership, domain, and custom account fields."
        title="Edit organization"
      />
      <OrganizationForm
        cancelHref={`/organizations/${organization.id}` as Route}
        initialOrganization={{
          id: organization.id,
          name: organization.name,
          domain: organization.domain,
          ownerId: organization.ownerId
        }}
        mode="edit"
        owners={owners}
        workspaceId={workspace.id}
      />
      <RecordCustomFieldsPanel
        emptyMessage="No organization custom fields have been created yet."
        entityId={organization.id}
        entityType="ORGANIZATION"
        fields={customFields}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}
