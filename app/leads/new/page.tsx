import { AppShell } from "@/components/app-shell";
import { LeadForm } from "@/components/lead-form";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace, listOrganizations, listPeople } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewLeadPage({
  searchParams
}: {
  searchParams?: Promise<{ source?: string; title?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [people, organizations, workspaceDetail] = await Promise.all([
    listPeople(actor),
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
          <p className="page-kicker">Leads</p>
          <h1 className="page-title">New Lead</h1>
        </div>
      </header>
      <LeadForm
        defaultOwnerId={actorUserId}
        defaultSource={firstSearchParam(resolvedSearchParams?.source)}
        defaultTitle={firstSearchParam(resolvedSearchParams?.title)}
        mode="create"
        organizations={organizations.map((organization) => ({ id: organization.id, name: organization.name }))}
        owners={owners}
        people={people.map((person) => ({ id: person.id, name: formatPersonName(person) }))}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function firstSearchParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.slice(0, 160);
}
