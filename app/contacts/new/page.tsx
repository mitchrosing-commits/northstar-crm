import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";
import { FormHeaderActions } from "@/components/form-header-actions";
import { PageHeader } from "@/components/page-header";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace, listOrganizations } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewContactPage({
  searchParams
}: {
  searchParams?: Promise<{ email?: string; name?: string; organizationId?: string }>;
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
  const defaultEmail = firstSearchParam(resolvedSearchParams?.email);
  const defaultName = firstSearchParam(resolvedSearchParams?.name);
  const defaultOrganizationId = firstSearchParam(resolvedSearchParams?.organizationId);
  const organizationOptions = organizations.map((organization) => ({ id: organization.id, name: organization.name }));
  const hasPrefill = Boolean(defaultEmail || defaultName || defaultOrganizationId);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={<FormHeaderActions backHref="/contacts" backLabel="Back to contacts" />}
        eyebrow="Contacts"
        subtitle="Add a person record that can be linked to deals, organizations, activities, and email."
        title="New contact"
      />
      <ContactForm
        cancelHref="/contacts"
        defaultEmail={defaultEmail}
        defaultName={defaultName}
        defaultOrganizationId={organizationOptions.some((organization) => organization.id === defaultOrganizationId) ? defaultOrganizationId : undefined}
        defaultOwnerId={actorUserId}
        mode="create"
        organizations={organizationOptions}
        owners={owners}
        prefillNotice={
          hasPrefill
            ? "We prefilled this contact from your search or related-record shortcut. Review the details, then add the person."
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
