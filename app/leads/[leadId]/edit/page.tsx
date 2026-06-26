import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { LeadForm } from "@/components/lead-form";
import { StatusBadge } from "@/components/status-badge";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getLead, getWorkspace, listOrganizations, listPeople } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ leadId: string }>;
};

export default async function EditLeadPage({ params }: PageProps) {
  const { leadId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [lead, people, organizations, workspaceDetail] = await Promise.all([
    getLead(actor, leadId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
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
          <h1 className="page-title">Edit Lead</h1>
        </div>
      </header>
      {lead.status === "CONVERTED" ? (
        <section className="empty-state">
          <StatusBadge status={lead.status} />
          <h2>Converted leads are locked</h2>
          <p>This lead has already become a deal, so edit the deal record instead.</p>
          <Link className="text-link" href={`/leads/${lead.id}`}>
            Back to lead
          </Link>
        </section>
      ) : (
        <LeadForm
          initialLead={{
            id: lead.id,
            title: lead.title,
            source: lead.source,
            status: lead.status,
            ownerId: lead.ownerId,
            personId: lead.personId,
            organizationId: lead.organizationId
          }}
          mode="edit"
          organizations={organizations.map((organization) => ({ id: organization.id, name: organization.name }))}
          owners={owners}
          people={people.map((person) => ({ id: person.id, name: formatPersonName(person) }))}
          workspaceId={workspace.id}
        />
      )}
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
