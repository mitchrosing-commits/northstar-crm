import { notFound } from "next/navigation";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";
import { FormHeaderActions } from "@/components/form-header-actions";
import { PageHeader } from "@/components/page-header";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getPerson, getWorkspace, listOrganizations, listPersonCustomFields } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ personId: string }>;
};

export default async function EditContactPage({ params }: PageProps) {
  const { personId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const person = await getPerson(actor, personId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [organizations, workspaceDetail, customFields] = await Promise.all([
    listOrganizations(actor),
    getWorkspace(actor),
    listPersonCustomFields(actor, personId)
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
            backHref={`/contacts/${person.id}` as Route}
            backLabel="Back to contact"
            showCustomFieldsLink
          />
        }
        eyebrow="Contacts"
        subtitle="Keep contact details, ownership, organization, and custom fields current."
        title="Edit contact"
      />
      <ContactForm
        cancelHref={`/contacts/${person.id}` as Route}
        initialContact={{
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          phone: person.phone,
          organizationId: person.organizationId,
          ownerId: person.ownerId
        }}
        mode="edit"
        organizations={organizations.map((organization) => ({ id: organization.id, name: organization.name }))}
        owners={owners}
        workspaceId={workspace.id}
      />
      <RecordCustomFieldsPanel
        emptyMessage="No contact custom fields have been created yet."
        entityId={person.id}
        entityType="PERSON"
        fields={customFields}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}
