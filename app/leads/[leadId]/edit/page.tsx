import { notFound } from "next/navigation";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { FormHeaderActions } from "@/components/form-header-actions";
import { LeadForm } from "@/components/lead-form";
import { PageHeader } from "@/components/page-header";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { RecordLockedNotice } from "@/components/record-locked-notice";
import { StatusBadge } from "@/components/status-badge";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import { getLead, getWorkspace, listLeadCustomFields, listOrganizations, listPeople } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ leadId: string }>;
};

export default async function EditLeadPage({ params }: PageProps) {
  const { leadId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const lead = await getLead(actor, leadId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [people, organizations, workspaceDetail, customFields] = await Promise.all([
    listPeople(actor),
    listOrganizations(actor),
    getWorkspace(actor),
    listLeadCustomFields(actor, leadId)
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
            backHref={`/leads/${lead.id}` as Route}
            backLabel="Back to lead"
            showCustomFieldsLink={lead.status !== "CONVERTED"}
          />
        }
        eyebrow="Leads"
        subtitle="Update lead qualification details before conversion locks the record."
        title="Edit lead"
      />
      {lead.status === "CONVERTED" ? (
        <RecordLockedNotice
          actions={[{ href: `/leads/${lead.id}`, label: "Back to lead" }]}
          badge={<StatusBadge status={lead.status} />}
          title="Converted leads are locked"
        >
          This lead has already become a deal, so edit the deal record instead.
        </RecordLockedNotice>
      ) : (
        <>
          <LeadForm
            cancelHref={`/leads/${lead.id}` as Route}
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
            people={people.map((person) => ({ id: person.id, name: formatPersonName(person) ?? "Unnamed contact" }))}
            workspaceId={workspace.id}
          />
          <RecordCustomFieldsPanel
            emptyMessage="No lead custom fields have been created yet."
            entityId={lead.id}
            entityType="LEAD"
            fields={customFields}
            workspaceId={workspace.id}
          />
        </>
      )}
    </AppShell>
  );
}
