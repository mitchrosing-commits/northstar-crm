import { AppShell } from "@/components/app-shell";
import { OrganizationForm } from "@/components/organization-form";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const workspaceDetail = await getWorkspace({ workspaceId: workspace.id, actorUserId });
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Organizations</p>
          <h1 className="page-title">New Organization</h1>
        </div>
      </header>
      <OrganizationForm defaultOwnerId={actorUserId} mode="create" owners={owners} workspaceId={workspace.id} />
    </AppShell>
  );
}
