import { AppShell } from "@/components/app-shell";
import { FormHeaderActions } from "@/components/form-header-actions";
import { LeadForm } from "@/components/lead-form";
import { PageHeader } from "@/components/page-header";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
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
  const defaultSource = firstSearchParam(resolvedSearchParams?.source);
  const defaultTitle = firstSearchParam(resolvedSearchParams?.title);
  const hasPrefill = Boolean(defaultSource || defaultTitle);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={<FormHeaderActions backHref="/leads" backLabel="Back to leads" />}
        eyebrow="Leads"
        subtitle="Capture an early opportunity before it is qualified into the active deal pipeline."
        title="New lead"
      />
      <LeadForm
        cancelHref="/leads"
        defaultOwnerId={actorUserId}
        defaultSource={defaultSource}
        defaultTitle={defaultTitle}
        mode="create"
        organizations={organizations.map((organization) => ({ id: organization.id, name: organization.name }))}
        owners={owners}
        people={people.map((person) => ({ id: person.id, name: formatPersonName(person) ?? "Unnamed contact" }))}
        prefillNotice={
          hasPrefill
            ? "We prefilled this lead from your search shortcut. Review the details, then capture the opportunity."
            : undefined
        }
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}

function firstSearchParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.slice(0, 160);
}
