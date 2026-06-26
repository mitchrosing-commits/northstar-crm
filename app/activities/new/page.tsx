import type { Route } from "next";
import Link from "next/link";

import { ActivityForm } from "@/components/activity-form";
import { AppShell } from "@/components/app-shell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace, listDeals, listLeads, listOrganizations, listPeople } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function NewActivityPage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [workspaceRecord, deals, people, organizations, leads] = await Promise.all([
    getWorkspace(actor),
    listDeals(actor, { status: "OPEN" }),
    listPeople(actor),
    listOrganizations(actor),
    listLeads(actor)
  ]);
  const owners = workspaceRecord.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const attachmentOptions = [
    ...deals.map((deal) => ({ label: `Deal: ${deal.title}`, value: `deal:${deal.id}` })),
    ...people.map((person) => ({ label: `Contact: ${formatPersonName(person)}`, value: `person:${person.id}` })),
    ...organizations.map((organization) => ({
      label: `Organization: ${organization.name}`,
      value: `organization:${organization.id}`
    })),
    ...leads
      .filter((lead) => lead.status !== "CONVERTED")
      .map((lead) => ({ label: `Lead: ${lead.title}`, value: `lead:${lead.id}` }))
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Activity</p>
          <h1 className="page-title">New Activity</h1>
        </div>
        <Link className="button-secondary" href="/activities">
          Back to activities
        </Link>
      </header>

      <section className="data-card">
        <h2 className="panel-title">Create Follow-up</h2>
        {attachmentOptions.length === 0 ? (
          <div className="empty-state" style={{ marginBottom: 16 }}>
            <h3>Create something to follow up on</h3>
            <p>
              Activities need a related deal, contact, organization, or lead. Add one first, then come back to schedule
              the follow-up.
            </p>
            <div className="filter-actions">
              <Link className="button-secondary button-compact" href={"/deals/new" as Route}>
                Add a deal
              </Link>
              <Link className="button-secondary button-compact" href={"/contacts/new" as Route}>
                Add a contact
              </Link>
              <Link className="button-secondary button-compact" href={"/organizations/new" as Route}>
                Add an organization
              </Link>
              <Link className="button-secondary button-compact" href={"/leads/new" as Route}>
                Add a lead
              </Link>
            </div>
          </div>
        ) : null}
        <ActivityForm
          attachmentOptions={attachmentOptions}
          defaultOwnerId={actorUserId}
          owners={owners}
          redirectTo={"/activities" as Route}
          submitLabel="Create activity"
          workspaceId={workspace.id}
        />
      </section>
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
