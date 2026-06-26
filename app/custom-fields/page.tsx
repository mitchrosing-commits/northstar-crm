import { CustomFieldDefinitionForm } from "@/components/custom-field-definition-form";
import { AppShell } from "@/components/app-shell";
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

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Settings</p>
          <h1 className="page-title">Custom Fields</h1>
        </div>
      </header>

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
        <div className="data-card">
          <h2 className="panel-title">New Custom Field</h2>
          <p className="empty-copy" style={{ marginBottom: 14 }}>
            Choose where the field applies. Each field appears only on matching records.
          </p>
          <CustomFieldDefinitionForm workspaceId={workspace.id} />
        </div>
      </section>
    </AppShell>
  );
}

type CustomField = Awaited<ReturnType<typeof listCustomFields>>[number];

function CustomFieldTable({
  emptyMessage,
  fields,
  title
}: {
  emptyMessage: string;
  fields: CustomField[];
  title: string;
}) {
  return (
    <div className="data-card">
      <h2 className="panel-title">{title}</h2>
      {fields.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Key</th>
              <th>Type</th>
              <th>Required</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.id}>
                <td>{field.name}</td>
                <td>{field.key}</td>
                <td>{field.fieldType}</td>
                <td>{field.required ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-copy">{emptyMessage}</p>
      )}
    </div>
  );
}
