import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace, listOrganizations } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewContactPage({
  searchParams
}: {
  searchParams?: Promise<{ email?: string; name?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [organizations, workspaceDetail] = await Promise.all([
    listOrganizations(actor),
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
          <p className="page-kicker">Contacts</p>
          <h1 className="page-title">New Contact</h1>
        </div>
      </header>
      <ContactForm
        defaultEmail={firstSearchParam(resolvedSearchParams?.email)}
        defaultName={firstSearchParam(resolvedSearchParams?.name)}
        defaultOwnerId={actorUserId}
        mode="create"
        organizations={organizations.map((organization) => ({ id: organization.id, name: organization.name }))}
        owners={owners}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}

function firstSearchParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.slice(0, 160);
}
