import type { Route } from "next";
import Link from "next/link";

import { ActivityForm } from "@/components/activity-form";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { FormHeaderActions } from "@/components/form-header-actions";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import { parseReturnToHref, returnToLabel } from "@/lib/return-to";
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
    returnTo?: string;
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
    ...people.map((person) => ({ label: `Contact: ${formatPersonName(person) ?? "Unnamed contact"}`, value: `person:${person.id}` })),
    ...organizations.map((organization) => ({
      label: `Organization: ${organization.name}`,
      value: `organization:${organization.id}`
    })),
    ...leads
      .filter((lead) => lead.status !== "CONVERTED")
      .map((lead) => ({ label: `Lead: ${lead.title}`, value: `lead:${lead.id}` }))
  ].sort((a, b) => a.label.localeCompare(b.label));
  const initialAttachmentValue = parseInitialAttachmentValue(resolvedSearchParams);
  const returnHref = parseReturnToHref(resolvedSearchParams?.returnTo, "/activities");
  const returnLabel = returnToLabel(returnHref);
  const hasPrefill =
    Boolean(resolvedSearchParams?.title) ||
    Boolean(resolvedSearchParams?.description) ||
    Boolean(resolvedSearchParams?.due) ||
    Boolean(initialAttachmentValue);
  const addDealActionLabel = "Add a deal before creating an activity";
  const addContactActionLabel = "Add a contact before creating an activity";
  const addOrganizationActionLabel = "Add an organization before creating an activity";
  const addLeadActionLabel = "Add a lead before creating an activity";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <FormHeaderActions
            backHref={returnHref}
            backLabel={returnLabel}
          />
        }
        eyebrow="Activity"
        subtitle="Schedule the next call, email, meeting, or task against a CRM record."
        title="New activity"
      />

      <section className="data-card">
        <PanelTitleRow title="Create Follow-up" />
        {hasPrefill ? (
          <FormIntroCallout title="Prefilled follow-up">
            We prefilled this activity from your search or record shortcut. Review the details, then save the
            follow-up.
          </FormIntroCallout>
        ) : null}
        {attachmentOptions.length === 0 ? (
          <EmptyState
            actions={
              <>
                <Link
                  aria-label={addDealActionLabel}
                  className="button-secondary button-compact"
                  href={"/deals/new" as Route}
                  title={addDealActionLabel}
                >
                  Add a deal
                </Link>
                <Link
                  aria-label={addContactActionLabel}
                  className="button-secondary button-compact"
                  href={"/contacts/new" as Route}
                  title={addContactActionLabel}
                >
                  Add a contact
                </Link>
                <Link
                  aria-label={addOrganizationActionLabel}
                  className="button-secondary button-compact"
                  href={"/organizations/new" as Route}
                  title={addOrganizationActionLabel}
                >
                  Add an organization
                </Link>
                <Link
                  aria-label={addLeadActionLabel}
                  className="button-secondary button-compact"
                  href={"/leads/new" as Route}
                  title={addLeadActionLabel}
                >
                  Add a lead
                </Link>
              </>
            }
            className="section-separated"
            description="Activities need a related deal, contact, organization, or lead. Add one first, then come back to schedule the follow-up."
            title="Create something to follow up on"
          />
        ) : null}
        {attachmentOptions.length > 0 ? (
          <ActivityForm
            attachmentOptions={attachmentOptions}
            cancelHref={returnHref}
            cancelLabel={returnLabel}
            defaultOwnerId={actorUserId}
            initialAttachmentValue={initialAttachmentValue}
            initialDescription={trimParam(resolvedSearchParams?.description)}
            initialDueAt={parseDueDateParam(resolvedSearchParams?.due)}
            initialTitle={trimParam(resolvedSearchParams?.title)}
            initialType={parseActivityType(resolvedSearchParams?.type)}
            owners={owners}
            redirectTo={returnHref}
            submitLabel="Create activity"
            workspaceId={workspace.id}
          />
        ) : null}
      </section>
    </AppShell>
  );
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
