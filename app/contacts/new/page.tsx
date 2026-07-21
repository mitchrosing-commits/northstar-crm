import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";
import { FormHeaderActions } from "@/components/form-header-actions";
import { PageHeader } from "@/components/page-header";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { parseReturnToHref } from "@/lib/return-to";
import { getWorkspace, listOrganizations } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewContactPage({
  searchParams
}: {
  searchParams?: Promise<{ email?: string; name?: string; organizationId?: string; returnTo?: string }>;
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
  const returnTo = leadOrActivityReturnToParam(resolvedSearchParams?.returnTo);
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
        cancelHref={(returnTo ?? "/contacts") as Route}
        defaultEmail={defaultEmail}
        defaultName={defaultName}
        defaultOrganizationId={organizationOptions.some((organization) => organization.id === defaultOrganizationId) ? defaultOrganizationId : undefined}
        defaultOwnerId={actorUserId}
        mode="create"
        organizations={organizationOptions}
        owners={owners}
        prefillNotice={
          returnTo
            ? "Create this contact, then Northstar will return to the source form with the contact selected."
            : hasPrefill
            ? "We prefilled this contact from your search or related-record shortcut. Review the details, then add the person."
            : undefined
        }
        returnTo={returnTo ? { href: returnTo, paramName: "personId" } : undefined}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}

function firstSearchParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.slice(0, 160);
}

function leadOrActivityReturnToParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  const returnTo = first?.slice(0, 700);
  if (!returnTo) return null;
  const activityReturnTo = parseReturnToHref(returnTo, "/contacts");
  if (String(activityReturnTo).startsWith("/activities/new")) return activityReturnTo;
  if (returnTo === "/leads/new" || returnTo.startsWith("/leads/new?")) return returnTo;
  if (/^\/leads\/[^/?#]+\/edit(?:\?.*)?$/.test(returnTo)) return returnTo;
  return null;
}
