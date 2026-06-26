import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { OrganizationForm } from "@/components/organization-form";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getOrganization, getWorkspace } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function EditOrganizationPage({ params }: PageProps) {
  const { organizationId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [organization, workspaceDetail] = await Promise.all([
    getOrganization(actor, organizationId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    getWorkspace(actor)
  ]);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Organizations</p>
          <h1 className="page-title">Edit Organization</h1>
        </div>
      </header>
      <OrganizationForm
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
    </AppShell>
  );
}
