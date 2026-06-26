import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getPerson, getWorkspace, listOrganizations } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ personId: string }>;
};

export default async function EditContactPage({ params }: PageProps) {
  const { personId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [person, organizations, workspaceDetail] = await Promise.all([
    getPerson(actor, personId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
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
          <h1 className="page-title">Edit Contact</h1>
        </div>
      </header>
      <ContactForm
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
    </AppShell>
  );
}
