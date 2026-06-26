import type { Route } from "next";
import Link from "next/link";

import { ActivityForm } from "@/components/activity-form";
import { AppShell } from "@/components/app-shell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspace, listDeals, listLeads, listOrganizations, listPeople } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    dealId?: string;
    description?: string;
    due?: string;
    leadId?: string;
    organizationId?: string;
    personId?: string;
    related?: string;
    title?: string;
    type?: string;
  }>;
};

export default async function NewActivityPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
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
  const initialAttachmentValue = parseInitialAttachmentValue(resolvedSearchParams);
  const hasPrefill =
    Boolean(resolvedSearchParams?.title) ||
    Boolean(resolvedSearchParams?.description) ||
    Boolean(resolvedSearchParams?.due) ||
    Boolean(initialAttachmentValue);

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
        {hasPrefill ? (
          <p className="form-hint" style={{ marginBottom: 12 }}>
            We prefilled this activity from the record you were viewing. Review the details, then save the follow-up.
          </p>
        ) : null}
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
          initialAttachmentValue={initialAttachmentValue}
          initialDescription={trimParam(resolvedSearchParams?.description)}
          initialDueAt={parseDueDateParam(resolvedSearchParams?.due)}
          initialTitle={trimParam(resolvedSearchParams?.title)}
          initialType={parseActivityType(resolvedSearchParams?.type)}
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

function parseInitialAttachmentValue(searchParams: Awaited<PageProps["searchParams"]>) {
  if (searchParams?.related) return normalizeAttachmentValue(searchParams.related);
  if (searchParams?.dealId) return `deal:${searchParams.dealId}`;
  if (searchParams?.leadId) return `lead:${searchParams.leadId}`;
  if (searchParams?.personId) return `person:${searchParams.personId}`;
  if (searchParams?.organizationId) return `organization:${searchParams.organizationId}`;
  return "";
}

function normalizeAttachmentValue(value: string) {
  const [type, id] = value.split(":");
  if (!id) return "";
  if (["deal", "lead", "person", "organization"].includes(type)) return `${type}:${id}`;
  return "";
}

function parseActivityType(value: string | undefined) {
  if (value === "CALL" || value === "EMAIL" || value === "MEETING" || value === "TASK") return value;
  return "TASK";
}

function parseDueDateParam(value: string | undefined) {
  const trimmed = trimParam(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function trimParam(value: string | undefined) {
  return value?.trim().slice(0, 500) ?? "";
}
