import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CustomFieldDefinitionForm } from "@/components/custom-field-definition-form";
import { EmptyState } from "@/components/empty-state";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatCard } from "@/components/stat-card";
import { TableScroll } from "@/components/table-scroll";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listCustomFields } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function CustomFieldsPage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const fields = await listCustomFields({ workspaceId: workspace.id, actorUserId });
  const dealFields = fields.filter((field) => field.entityType === "DEAL");
  const contactFields = fields.filter((field) => field.entityType === "PERSON");
  const organizationFields = fields.filter((field) => field.entityType === "ORGANIZATION");
  const leadFields = fields.filter((field) => field.entityType === "LEAD");
  const backToSettingsLabel = "Back to settings from custom fields";
  const newFieldLabel = "Create a new custom field";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <>
            <Link
              aria-label={backToSettingsLabel}
              className="button-secondary"
              href="/settings"
              title={backToSettingsLabel}
            >
              Back to settings
            </Link>
            <a
              aria-label={newFieldLabel}
              className="button-primary"
              href="#new-custom-field"
              title={newFieldLabel}
            >
              New field
            </a>
          </>
        }
        eyebrow="Settings"
        subtitle="Define focused workspace fields for deals, contacts, organizations, and leads."
        title="Custom Fields"
      />

      <section className="stat-grid stat-grid-compact" aria-label="Custom field coverage">
        <CustomFieldStat label="Deal fields" value={dealFields.length} />
        <CustomFieldStat label="Contact fields" value={contactFields.length} />
        <CustomFieldStat label="Organization fields" value={organizationFields.length} />
        <CustomFieldStat label="Lead fields" value={leadFields.length} />
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          actions={<Badge label="Custom field definitions are scoped to the active workspace">Workspace scoped</Badge>}
          description="Custom fields are defined once per workspace and appear only on the matching record type."
          title="Custom Field Guardrails"
        />
        <FormIntroCallout className="custom-field-guardrails-callout" title="Keep fields maintainable">
          Start with stable sales fields your team will actually maintain; complex import mapping and advanced field types
          remain separate follow-ups.
        </FormIntroCallout>
      </section>

      <section className="detail-grid">
        <CustomFieldTable
          emptyMessage="No deal custom fields have been created yet."
          fields={dealFields}
          title="Deal Fields"
        />
        <CustomFieldTable
          emptyMessage="No contact custom fields have been created yet."
          fields={contactFields}
          title="Contact Fields"
        />
        <CustomFieldTable
          emptyMessage="No organization custom fields have been created yet."
          fields={organizationFields}
          title="Organization Fields"
        />
        <CustomFieldTable
          emptyMessage="No lead custom fields have been created yet."
          fields={leadFields}
          title="Lead Fields"
        />
        <div className="data-card" id="new-custom-field">
          <PanelTitleRow
            description="Choose where the field applies. Each field appears only on matching records and uses the existing workspace validation path."
            title="New Custom Field"
          />
          <CustomFieldDefinitionForm workspaceId={workspace.id} />
        </div>
      </section>
    </AppShell>
  );
}

type CustomField = Awaited<ReturnType<typeof listCustomFields>>[number];

function CustomFieldStat({ label, value }: { label: string; value: number }) {
  return <StatCard label={label} value={value} />;
}

function CustomFieldTable({
  emptyMessage,
  fields,
  title
}: {
  emptyMessage: string;
  fields: CustomField[];
  title: string;
}) {
  const createFieldLabel = `Create a ${title.toLowerCase().replace(" fields", "")} custom field`;
  const fieldCountLabel = `${title} custom field count: ${fields.length}`;

  return (
    <div className="data-card">
      <PanelTitleRow
        actions={
          <Badge className="count-badge" label={fieldCountLabel}>
            {fields.length}
          </Badge>
        }
        actionsLabel={`${title} custom field count`}
        description="Text, number, date, boolean, and single-select fields are supported in v1."
        title={title}
      />
      {fields.length > 0 ? (
        <TableScroll aria-label={`${title} table`}>
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.id}>
                  <td data-label="Field">
                    <div className="table-primary-cell">
                      <strong>{field.name}</strong>
                      <span className="table-secondary-text">{field.key}</span>
                    </div>
                  </td>
                  <td data-label="Type">
                    <Badge label={`Custom field type: ${field.fieldType}`}>{field.fieldType}</Badge>
                  </td>
                  <td data-label="Required">
                    <Badge
                      className={field.required ? "badge badge-qualified" : "badge"}
                      label={field.required ? "Required custom field" : "Optional custom field"}
                    >
                      {field.required ? "Required" : "Optional"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <EmptyState
          actions={
            <a
              aria-label={createFieldLabel}
              className="button-secondary button-compact"
              href="#new-custom-field"
              title={createFieldLabel}
            >
              Create field
            </a>
          }
          className="empty-state-compact empty-state-panel"
          description={emptyMessage}
          title="No fields configured"
        />
      )}
    </div>
  );
}
