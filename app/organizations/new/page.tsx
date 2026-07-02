import { AppShell } from "@/components/app-shell";
import { FormHeaderActions } from "@/components/form-header-actions";
import { OrganizationForm } from "@/components/organization-form";
import { PageHeader } from "@/components/page-header";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage({
  searchParams
}: {
  searchParams?: Promise<{ name?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const workspaceDetail = await getWorkspace({ workspaceId: workspace.id, actorUserId });
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const defaultName = firstSearchParam(resolvedSearchParams?.name);
  const hasPrefill = Boolean(defaultName);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={<FormHeaderActions backHref="/organizations" backLabel="Back to organizations" />}
        eyebrow="Organizations"
        subtitle="Create an account record for grouping contacts, deals, activities, and notes."
        title="New organization"
      />
      <OrganizationForm
        cancelHref="/organizations"
        defaultName={defaultName}
        defaultOwnerId={actorUserId}
        mode="create"
        owners={owners}
        prefillNotice={
          hasPrefill
            ? "We prefilled this organization from your search shortcut. Review the details, then create the account."
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
