import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isEditableCustomFieldType,
  isFilterableCustomFieldType,
  isCustomFieldFilterOperatorAllowed,
  isEmptyCustomFieldValue,
  normalizeCustomFieldFilterOperator,
} from "@/lib/custom-field-display";

const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const route = readFileSync(
  join(
    process.cwd(),
    "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts",
  ),
  "utf8",
);
const validators = readFileSync(
  join(process.cwd(), "lib/validators/crm.ts"),
  "utf8",
);
const service = readFileSync(
  join(process.cwd(), "lib/services/custom-field-service.ts"),
  "utf8",
);
const recordGuards = readFileSync(
  join(process.cwd(), "lib/services/record-guards.ts"),
  "utf8",
);
const primaryNav = readFileSync(
  join(process.cwd(), "components/primary-nav.tsx"),
  "utf8",
);
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const adminPage = readFileSync(
  join(process.cwd(), "app/custom-fields/page.tsx"),
  "utf8",
);
const definitionForm = readFileSync(
  join(process.cwd(), "components/custom-field-definition-form.tsx"),
  "utf8",
);
const dealDetail = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/page.tsx"),
  "utf8",
);
const contactDetail = readFileSync(
  join(process.cwd(), "app/contacts/[personId]/page.tsx"),
  "utf8",
);
const organizationDetail = readFileSync(
  join(process.cwd(), "app/organizations/[organizationId]/page.tsx"),
  "utf8",
);
const leadDetail = readFileSync(
  join(process.cwd(), "app/leads/[leadId]/page.tsx"),
  "utf8",
);
const dealEdit = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/edit/page.tsx"),
  "utf8",
);
const contactEdit = readFileSync(
  join(process.cwd(), "app/contacts/[personId]/edit/page.tsx"),
  "utf8",
);
const organizationEdit = readFileSync(
  join(process.cwd(), "app/organizations/[organizationId]/edit/page.tsx"),
  "utf8",
);
const leadEdit = readFileSync(
  join(process.cwd(), "app/leads/[leadId]/edit/page.tsx"),
  "utf8",
);
const formHeaderActions = readFileSync(
  join(process.cwd(), "components/form-header-actions.tsx"),
  "utf8",
);
const dealList = readFileSync(
  join(process.cwd(), "app/deals/page.tsx"),
  "utf8",
);
const contactListState = readFileSync(
  join(process.cwd(), "lib/contact-list-state.ts"),
  "utf8",
);
const dealListState = readFileSync(
  join(process.cwd(), "lib/deal-list-state.ts"),
  "utf8",
);
const leadListState = readFileSync(
  join(process.cwd(), "lib/lead-list-state.ts"),
  "utf8",
);
const organizationListState = readFileSync(
  join(process.cwd(), "lib/organization-list-state.ts"),
  "utf8",
);
const contactList = readFileSync(
  join(process.cwd(), "app/contacts/page.tsx"),
  "utf8",
);
const organizationList = readFileSync(
  join(process.cwd(), "app/organizations/page.tsx"),
  "utf8",
);
const leadList = readFileSync(
  join(process.cwd(), "app/leads/page.tsx"),
  "utf8",
);
const formFieldLabel = readFileSync(
  join(process.cwd(), "components/form-field-label.tsx"),
  "utf8",
);
const recordCustomFieldsForm = readFileSync(
  join(process.cwd(), "components/record-custom-fields-form.tsx"),
  "utf8",
);
const recordCustomFieldsPanel = readFileSync(
  join(process.cwd(), "components/record-custom-fields-panel.tsx"),
  "utf8",
);
const recordPanelJumpNav = readFileSync(
  join(process.cwd(), "components/record-panel-jump-nav.tsx"),
  "utf8",
);
const customFieldListSummary = readFileSync(
  join(process.cwd(), "components/custom-field-list-summary.tsx"),
  "utf8",
);
const inlineEmptyStateText = readFileSync(
  join(process.cwd(), "components/inline-empty-state-text.tsx"),
  "utf8",
);
const customFieldDisplay = readFileSync(
  join(process.cwd(), "lib/custom-field-display.ts"),
  "utf8",
);
const statCard = readFileSync(
  join(process.cwd(), "components/stat-card.tsx"),
  "utf8",
);
const tableScroll = readFileSync(
  join(process.cwd(), "components/table-scroll.tsx"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const openapi = readFileSync(join(process.cwd(), "docs/openapi.yaml"), "utf8");
const apiRouteMap = readFileSync(
  join(process.cwd(), "docs/api-route-map.md"),
  "utf8",
);
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
const currentStatus = readFileSync(
  join(process.cwd(), "docs/current-status.md"),
  "utf8",
);
const architecture = readFileSync(
  join(process.cwd(), "docs/architecture.md"),
  "utf8",
);
const customFieldFilteringDesign = readFileSync(
  join(process.cwd(), "docs/custom-field-filtering-v1-design.md"),
  "utf8",
);

describe("custom fields UI and API behavior", () => {
  it("uses the existing generic custom field schema for primary CRM record definitions and values", () => {
    expect(schema).toContain("model CustomFieldDefinition");
    expect(schema).toContain("model CustomFieldValue");
    expect(schema).toContain("PERSON");
    expect(schema).toContain("LEAD");
    expect(schema).toContain("@@unique([workspaceId, entityType, key])");
    expect(schema).toContain("@@unique([fieldId, entityId])");
  });

  it("routes custom field definition and value writes through validated workspace APIs", () => {
    expect(route).toContain("createCustomFieldSchema.parse");
    expect(route).toContain('resource === "custom-field-values"');
    expect(route).toContain("upsertCustomFieldValuesSchema.parse");
    expect(route).toContain("upsertCustomFieldValues(actor");
    expect(validators).toContain(
      'entityType: z.enum(["DEAL", "PERSON", "ORGANIZATION", "LEAD"])',
    );
    expect(validators).toContain(
      'fieldType: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"])',
    );
    expect(validators).toContain("export const upsertCustomFieldValuesSchema");
  });

  it("keeps custom fields workspace-scoped, entity-scoped, validated, and audited", () => {
    expect(service).toContain("ensureWorkspaceAccess(actor)");
    expect(service).toContain("normalizeCustomFieldEntityType");
    expect(service).toContain(
      "Custom field entity type must be DEAL, PERSON, ORGANIZATION, or LEAD.",
    );
    expect(service).toContain("const input = objectInput(data)");
    expect(service).toContain("normalizeCustomFieldType(input.fieldType)");
    expect(service).toContain(
      "Custom field type must be TEXT, NUMBER, DATE, BOOLEAN, or SELECT.",
    );
    expect(service).toContain(
      "normalizeCustomFieldDefinitionInput(input, fieldType)",
    );
    expect(service).toContain(
      "normalizeCustomFieldOptions(data.options, fieldType)",
    );
    expect(service).toContain(
      "Select custom fields require at least one option.",
    );
    expect(service).toContain(
      "Custom field key must use lowercase letters, numbers, and underscores.",
    );
    expect(service).toContain(
      "Custom field required flag must be true or false.",
    );
    expect(service).toContain("normalizeCustomFieldValuesInput(input.values)");
    expect(service).toContain("Custom field values must be an object.");
    expect(service).toContain("normalizeCustomFieldRecordId(input.entityId)");
    expect(service).toContain("Custom field record id must be text.");
    expect(service).toContain("workspaceId: actor.workspaceId");
    expect(service).toContain(
      "assertRecordInWorkspace(recordModel(entityType)",
    );
    expect(service).toContain(
      "function recordModel(entityType: EditableCustomFieldEntityType)",
    );
    expect(recordGuards).toContain(
      "const where = { id, workspaceId, deletedAt: null }",
    );
    expect(service).toContain("listPersonCustomFields");
    expect(service).toContain("listOrganizationCustomFields");
    expect(service).toContain("listLeadCustomFields");
    expect(service).toContain("assertDealCustomFieldsEditable");
    expect(service).toContain("DEAL_CLOSED");
    expect(service).toContain("assertLeadCustomFieldsEditable");
    expect(service).toContain("LEAD_CONVERTED");
    expect(service).toContain('return "organization"');
    expect(service).toContain('return "lead"');
    expect(service).toContain(
      "const entityType = normalizeCustomFieldEntityType(input.entityType)",
    );
    expect(service).toContain("entityType,");
    expect(service).toContain("normalizeCustomFieldValue");
    expect(service).toContain("field.required");
    expect(service).toContain("customFieldJsonValuesEqual");
    expect(service).toContain(
      "const changedUpdates = normalizedUpdates.filter",
    );
    expect(service).toContain(
      "update: { workspaceId: actor.workspaceId, entityType, value }",
    );
    expect(service).toContain(
      "return listRecordCustomFields(actor, entityType, entityId)",
    );
    expect(service).toContain("custom_field.created");
    expect(service).toContain("custom_field_value.updated");
    expect(openapi).toContain(
      "Updates values for open Deal, Contact/Person, Organization, or unconverted Lead custom fields.",
    );
    expect(openapi).toContain("enum: [TEXT, NUMBER, DATE, BOOLEAN, SELECT]");
    expect(openapi).toContain(
      "Supported editable field types are TEXT, NUMBER, DATE, BOOLEAN, and SELECT.",
    );
    expect(openapi).toContain(
      "including single-select values against configured string options",
    );
    expect(openapi).not.toContain("seeded SELECT fields are read-only");
    expect(apiRouteMap).toContain(
      "Supported editable field types are `TEXT`, `NUMBER`, `DATE`, `BOOLEAN`, and `SELECT`.",
    );
    expect(apiRouteMap).not.toContain(
      "field types such as `SELECT` are displayed read-only",
    );
    expect(readme).toContain("text, number, date, boolean, and select fields");
    expect(readme).not.toContain(
      "seeded `SELECT` fields are display-only/read-only",
    );
    expect(currentStatus).toContain(
      "Editable custom field types are `TEXT`, `NUMBER`, `DATE`, `BOOLEAN`, and `SELECT`.",
    );
    expect(currentStatus).not.toContain("including seeded `SELECT` examples");
    expect(customFieldFilteringDesign).toContain(
      "Editable-but-not-filterable field types today are:",
    );
    expect(customFieldFilteringDesign).toContain("`SELECT`");
    expect(customFieldFilteringDesign).not.toContain(
      "Unsupported field types such as `SELECT`",
    );
    expect(openapi).toContain(
      "Closed deals and converted leads reject custom field value updates.",
    );
    expect(openapi).toContain(
      "Closed deal or converted lead cannot be updated.",
    );
  });

  it("adds a custom fields admin page for Deal, Contact, Organization, and Lead fields", () => {
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(navigation).toContain('href: "/custom-fields"');
    expect(navigation).toContain('label: "Custom Fields"');
    expect(adminPage).toContain("CustomFieldDefinitionForm");
    expect(adminPage).toContain("PanelTitleRow");
    expect(adminPage).toContain('import { Badge } from "@/components/badge"');
    expect(adminPage).toContain("FormIntroCallout");
    expect(adminPage).toContain("listCustomFields");
    expect(adminPage).toContain("Define focused workspace fields");
    expect(adminPage).toContain('href="/settings"');
    expect(adminPage).toContain(
      'const backToSettingsLabel = "Back to settings from custom fields"',
    );
    expect(adminPage).toContain("aria-label={backToSettingsLabel}");
    expect(adminPage).toContain("title={backToSettingsLabel}");
    expect(adminPage).toContain('href="#new-custom-field"');
    expect(adminPage).toContain(
      'const newFieldLabel = "Create a new custom field"',
    );
    expect(adminPage).toContain("aria-label={newFieldLabel}");
    expect(adminPage).toContain("title={newFieldLabel}");
    expect(adminPage).toContain('aria-label="Custom field coverage"');
    expect(adminPage).toContain("CustomFieldStat");
    expect(adminPage).toContain("Custom Field Guardrails");
    expect(adminPage).toContain(
      '<Badge label="Custom field definitions are scoped to the active workspace">Workspace scoped</Badge>',
    );
    expect(adminPage).toContain('className="custom-field-guardrails-callout"');
    expect(adminPage).toContain('title="Keep fields maintainable"');
    expect(adminPage).toContain("Start with stable");
    expect(adminPage).toContain(
      "complex import mapping and advanced field types",
    );
    expect(adminPage).toContain("remain separate follow-ups");
    expect(adminPage).not.toContain(
      '<p className="empty-copy">\n          Start with stable sales fields',
    );
    expect(adminPage).toContain("existing workspace");
    expect(adminPage).toContain("Deal Fields");
    expect(adminPage).toContain("Contact Fields");
    expect(adminPage).toContain("Organization Fields");
    expect(adminPage).toContain("Lead Fields");
    expect(adminPage).toContain("StatCard");
    expect(adminPage).toContain("<StatCard label={label} value={value} />");
    expect(statCard).toContain('className="stat-card"');
    expect(adminPage).toContain("count-badge");
    expect(adminPage).toContain("const fieldCountLabel = `${title} custom field count: ${fields.length}`");
    expect(adminPage).toContain('<Badge className="count-badge" label={fieldCountLabel}>');
    expect(adminPage).toContain("actionsLabel={`${title} custom field count`}");
    expect(adminPage).toContain(
      "Text, number, date, boolean, and single-select fields are supported in v1.",
    );
    expect(adminPage).toContain("TableScroll");
    expect(tableScroll).toContain(
      'className={["table-scroll", className].filter(Boolean).join(" ")}',
    );
    expect(tableScroll).toContain('role="region"');
    expect(tableScroll).toContain("tabIndex={0}");
    expect(adminPage).toContain("aria-label={`${title} table`}");
    expect(adminPage).toContain('className="table crm-list-table"');
    expect(adminPage).toContain('data-label="Field"');
    expect(adminPage).toContain('data-label="Type"');
    expect(adminPage).toContain('data-label="Required"');
    expect(adminPage).toContain('className="table-primary-cell"');
    expect(adminPage).toContain('className="table-secondary-text"');
    expect(adminPage).toContain("label={`Custom field type: ${field.fieldType}`}");
    expect(adminPage).toContain('label={field.required ? "Required custom field" : "Optional custom field"}');
    expect(adminPage).toContain('field.required ? "Required" : "Optional"');
    expect(adminPage).toContain("Create field");
    expect(adminPage).toContain(
      'const createFieldLabel = `Create a ${title.toLowerCase().replace(" fields", "")} custom field`;',
    );
    expect(adminPage).toContain("aria-label={createFieldLabel}");
    expect(adminPage).toContain("title={createFieldLabel}");
    expect(adminPage).toContain('className="button-secondary button-compact"');
    expect(adminPage).toContain('href="#new-custom-field"');
    expect(definitionForm).toContain("Applies to");
    expect(definitionForm).toContain('["PERSON", "Contact"]');
    expect(definitionForm).toContain('["ORGANIZATION", "Organization"]');
    expect(definitionForm).toContain('["LEAD", "Lead"]');
    expect(definitionForm).toContain('["SELECT", "Select"]');
    expect(definitionForm).toContain("parseSelectOptions(optionsText)");
    expect(definitionForm).toContain("Add at least one select option.");
    expect(definitionForm).toContain("options: selectOptions");
    expect(definitionForm).toContain(
      "Enter one option per line, or separate options with commas.",
    );
    expect(definitionForm).toContain("import { FormFieldLabel }");
    expect(definitionForm).toContain(
      "<FormFieldLabel required>Applies to</FormFieldLabel>",
    );
    expect(definitionForm).toContain(
      "<FormFieldLabel required>Label</FormFieldLabel>",
    );
    expect(definitionForm).toContain(
      "<FormFieldLabel required>Key</FormFieldLabel>",
    );
    expect(definitionForm).toContain(
      "<FormFieldLabel required>Type</FormFieldLabel>",
    );
    expect(definitionForm).toContain(
      "<FormFieldLabel required>Options</FormFieldLabel>",
    );
    expect(definitionForm).toContain(
      "/api/v1/workspaces/${workspaceId}/custom-fields",
    );
    expect(definitionForm).toContain("slugKey");
  });

  it("renders and edits deal custom field values from the deal detail page", () => {
    expect(dealDetail).toContain("listDealCustomFields(actor, deal.id)");
    expect(dealDetail).toContain("RecordCustomFieldsPanel");
    expect(dealDetail).toContain('entityType="DEAL"');
    expect(dealDetail).toContain('readOnly={deal.status !== "OPEN"}');
    expect(dealDetail).toContain(
      'lockedMessage={closedDealLockMessage("customFields")}',
    );
    expect(recordCustomFieldsPanel).toContain('title = "Custom Fields"');
    expect(recordCustomFieldsForm).toContain(
      "/api/v1/workspaces/${workspaceId}/custom-field-values",
    );
    expect(recordCustomFieldsForm).toContain('entityType="DEAL"');
    expect(recordCustomFieldsForm).toContain("editableTypes");
    expect(recordCustomFieldsForm).toContain(
      "Custom fields are ready, but no values have been filled in yet.",
    );
    expect(recordCustomFieldsForm).toContain("custom-field-readonly");
    expect(recordCustomFieldsForm).toContain("import { EmptyState }");
    expect(recordCustomFieldsForm).toContain("function CustomFieldsEmptyState");
    expect(recordCustomFieldsForm).toContain(
      "empty-state-compact empty-state-panel record-custom-fields-empty",
    );
    expect(recordCustomFieldsForm).not.toContain(
      'return <p className="empty-copy">{emptyMessage}</p>;',
    );
    expect(recordCustomFieldsForm).toContain("import { FormFieldLabel }");
    expect(recordCustomFieldsForm).toContain('import { Badge } from "@/components/badge"');
    expect(recordCustomFieldsForm).toContain(
      "<FormFieldLabel required={field.required}>{field.name}</FormFieldLabel>",
    );
    expect(recordCustomFieldsForm).toContain('<Badge label={`${field.name} is read-only`}>Read-only</Badge>');
    expect(formFieldLabel).toContain("export function FormFieldLabel");
    expect(formFieldLabel).toContain('required ? "Required" : "Optional"');
    expect(globalStyles).toContain(".form-field .form-field-label");
    expect(recordCustomFieldsForm).toContain(
      '"TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"',
    );
    expect(recordCustomFieldsForm).toContain("selectOptions(field.options)");
    expect(recordCustomFieldsForm).toContain(
      "Only text, number, date, yes/no, and single-select fields can be edited in this MVP.",
    );
    expect(recordCustomFieldsForm).toContain(
      "const readOnlyCustomFieldMessage",
    );
    expect(recordCustomFieldsForm).toContain(
      "function CustomFieldReadOnlyNotice",
    );
    expect(recordCustomFieldsForm).toContain(
      'className="custom-field-readonly-note"',
    );
    expect(recordCustomFieldsForm).toContain("<CustomFieldReadOnlyNotice />");
    expect(recordCustomFieldsForm).not.toContain(
      '<p className="muted">Only text, number, date, yes/no, and single-select fields can be edited in this MVP.</p>',
    );
    expect(globalStyles).toContain(".custom-field-readonly-note");
    expect(service).toContain('field.fieldType === "SELECT"');
    expect(service).toContain("must be one of the configured options");
    expect(definitionForm).toContain("FormActionBar");
    expect(definitionForm).toContain('pendingLabel="Creating..."');
    expect(definitionForm).toContain("submitDisabled={!name.trim()}");
    expect(definitionForm).toContain('submitLabel="Create field"');
  });

  it("renders and edits contact custom field values from the contact detail page", () => {
    expect(contactDetail).toContain("listPersonCustomFields(actor, person.id)");
    expect(contactDetail).toContain("RecordCustomFieldsPanel");
    expect(contactDetail).toContain('entityType="PERSON"');
    expect(contactDetail).toContain(
      "No contact custom fields have been created yet.",
    );
    expect(recordCustomFieldsForm).toContain(
      "export function RecordCustomFieldsForm",
    );
    expect(recordCustomFieldsForm).toContain("entityType,");
  });

  it("renders and edits organization custom field values from the organization detail page", () => {
    expect(organizationDetail).toContain(
      "listOrganizationCustomFields(actor, organization.id)",
    );
    expect(organizationDetail).toContain("RecordCustomFieldsPanel");
    expect(organizationDetail).toContain('entityType="ORGANIZATION"');
    expect(organizationDetail).toContain(
      "No organization custom fields have been created yet.",
    );
    expect(recordCustomFieldsForm).toContain(
      'export type RecordCustomFieldEntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD"',
    );
  });

  it("renders and edits lead custom field values from the lead detail page when unconverted", () => {
    expect(leadDetail).toContain("listLeadCustomFields(actor, lead.id)");
    expect(leadDetail).toContain("RecordCustomFieldsPanel");
    expect(leadDetail).toContain('entityType="LEAD"');
    expect(leadDetail).toContain(
      "No lead custom fields have been created yet.",
    );
  });

  it("renders lead custom field values read-only when the lead is converted", () => {
    expect(leadDetail).toContain('readOnly={lead.status === "CONVERTED"}');
    expect(leadDetail).toContain('lead.status === "CONVERTED"');
    expect(leadDetail).toContain(
      'lockedMessage={convertedLeadLockMessage("customFields")}',
    );
    expect(recordCustomFieldsPanel).toContain("RecordCustomFieldsReadOnly");
    expect(recordCustomFieldsForm).toContain(
      "No custom field values have been filled in yet.",
    );
    expect(recordCustomFieldsForm).not.toContain(
      '<p className="empty-copy">No custom field values have been filled in yet.</p>',
    );
  });

  it("surfaces custom field inputs on safe edit flows without changing record locks", () => {
    expect(recordCustomFieldsPanel).toContain("RecordCustomFieldsForm");
    expect(recordCustomFieldsPanel).toContain("RecordCustomFieldsReadOnly");
    expect(recordCustomFieldsPanel).toContain(
      "data-card record-custom-fields-panel",
    );
    expect(recordCustomFieldsPanel).toContain('id = "custom-fields"');
    expect(recordCustomFieldsPanel).toContain("id={id}");
    expect(recordCustomFieldsPanel).toContain("PanelTitleRow");
    expect(recordCustomFieldsPanel).toContain("actions={");
    expect(recordCustomFieldsPanel).toContain(
      'const customFieldActionsLabel = "Custom field actions";',
    );
    expect(recordCustomFieldsPanel).toContain('import { Badge } from "@/components/badge"');
    expect(recordCustomFieldsPanel).toContain("import { ActionGroup }");
    expect(recordCustomFieldsPanel).toContain(
      '<ActionGroup className="filter-actions" label={customFieldActionsLabel}>',
    );
    expect(recordCustomFieldsPanel).toContain(
      'const fieldCountLabel = `${mappedFields.length} ${mappedFields.length === 1 ? "custom field" : "custom fields"} available in ${title}`;',
    );
    expect(recordCustomFieldsPanel).toContain("<Badge label={fieldCountLabel}>");
    expect(recordCustomFieldsPanel).toContain(
      '{mappedFields.length} {mappedFields.length === 1 ? "field" : "fields"}',
    );
    expect(recordCustomFieldsPanel).toContain(
      "Record-specific values from your workspace custom-field definitions.",
    );
    expect(recordCustomFieldsPanel).toContain(
      'href={"/custom-fields#new-custom-field" as Route}',
    );
    expect(recordCustomFieldsPanel).toContain(
      "const manageFieldsLabel = `${title}: manage workspace custom field definitions`",
    );
    expect(recordCustomFieldsPanel).toContain("aria-label={manageFieldsLabel}");
    expect(recordCustomFieldsPanel).toContain("title={manageFieldsLabel}");
    expect(recordCustomFieldsPanel).toContain("Manage fields");
    expect(recordCustomFieldsPanel).toContain("title={title}");
    expect(recordCustomFieldsPanel).toContain(
      "field.values?.[0]?.value ?? null",
    );
    for (const page of [
      dealDetail,
      contactDetail,
      organizationDetail,
      leadDetail,
    ]) {
      expect(page).toContain('customFieldsHref={"#custom-fields" as Route}');
    }
    expect(formHeaderActions).toContain('href={"#custom-fields" as Route}');
    expect(formHeaderActions).toContain(
      'aria-label="Jump to custom fields in this form"',
    );
    expect(formHeaderActions).toContain('title="Jump to custom fields"');

    expect(dealEdit).toContain("listDealCustomFields(actor, dealId)");
    expect(dealEdit).toContain("RecordCustomFieldsPanel");
    expect(dealEdit).toContain('entityType="DEAL"');
    expect(dealEdit).toContain('deal.status === "OPEN"');
    expect(dealEdit).toContain('showCustomFieldsLink={deal.status === "OPEN"}');
    expect(dealEdit).toContain("Closed deals are locked");

    expect(contactEdit).toContain("listPersonCustomFields(actor, personId)");
    expect(contactEdit).toContain('entityType="PERSON"');
    expect(contactEdit).toContain("showCustomFieldsLink");

    expect(organizationEdit).toContain(
      "listOrganizationCustomFields(actor, organizationId)",
    );
    expect(organizationEdit).toContain('entityType="ORGANIZATION"');
    expect(organizationEdit).toContain("showCustomFieldsLink");

    expect(leadEdit).toContain("listLeadCustomFields(actor, leadId)");
    expect(leadEdit).toContain('entityType="LEAD"');
    expect(leadEdit).toContain('lead.status === "CONVERTED"');
    expect(leadEdit).toContain('lead.status !== "CONVERTED"');
    expect(leadEdit).toContain(
      'showCustomFieldsLink={lead.status !== "CONVERTED"}',
    );
    expect(leadEdit).toContain("Converted leads are locked");
  });

  it("shows compact custom field summaries on Deal, Contact, Organization, and Lead list pages", () => {
    for (const page of [dealList, contactList, organizationList, leadList]) {
      expect(page).toContain("CustomFieldSummaryCell");
      expect(page).toContain("listCustomFieldSummaries");
      expect(page).toContain("<th>Custom fields</th>");
    }
    expect(dealList).toContain(
      'listCustomFields(actor, { entityType: "DEAL" })',
    );
    expect(contactList).toContain(
      'listCustomFields(actor, { entityType: "PERSON" })',
    );
    expect(organizationList).toContain(
      'listCustomFields(actor, { entityType: "ORGANIZATION" })',
    );
    expect(leadList).toContain(
      'listCustomFields(actor, { entityType: "LEAD" })',
    );
    expect(customFieldListSummary).toContain('emptyConfiguredLabel = "None configured"');
    expect(customFieldListSummary).toContain('emptyFilledLabel = "None filled"');
    expect(customFieldListSummary).toContain("InlineEmptyStateText");
    expect(customFieldListSummary).toContain(
      "<InlineEmptyStateText>{emptyConfiguredLabel}</InlineEmptyStateText>",
    );
    expect(customFieldListSummary).toContain(
      "<InlineEmptyStateText>{emptyFilledLabel}</InlineEmptyStateText>",
    );
    expect(dealList).toContain('emptyConfiguredLabel="No deal fields"');
    expect(dealList).toContain('emptyFilledLabel="No deal values"');
    expect(contactList).toContain('emptyConfiguredLabel="No contact fields"');
    expect(contactList).toContain('emptyFilledLabel="No contact values"');
    expect(organizationList).toContain('emptyConfiguredLabel="No organization fields"');
    expect(organizationList).toContain('emptyFilledLabel="No organization values"');
    expect(leadList).toContain('emptyConfiguredLabel="No lead fields"');
    expect(leadList).toContain('emptyFilledLabel="No lead values"');
    expect(customFieldListSummary).not.toContain(
      '<span className="muted">None configured</span>',
    );
    expect(customFieldListSummary).not.toContain(
      '<span className="muted">None filled</span>',
    );
    expect(inlineEmptyStateText).toContain("inline-empty-state-text");
    expect(customFieldListSummary).toContain('import { Badge } from "@/components/badge"');
    expect(customFieldListSummary).toContain('<Badge label={`${field.name} is read-only`}>Read-only</Badge>');
    expect(customFieldListSummary).toContain("isEditableCustomFieldType");
    expect(customFieldListSummary).toContain(
      'const previewSummary = `${previewFields.map(summaryText).join(" · ")}${extraCount > 0 ? ` +${extraCount}` : ""}`',
    );
    expect(customFieldListSummary).toContain(
      'const filledCountLabel = `${filledFields.length}/${fields.length} filled`',
    );
    expect(customFieldListSummary).toContain(
      "const summaryLabel = `Custom field summary: ${previewSummary}. ${filledFields.length} of ${fields.length} custom fields filled.`",
    );
    expect(customFieldListSummary).toContain("aria-label={summaryLabel}");
    expect(customFieldListSummary).toContain("title={summaryLabel}");
    expect(customFieldListSummary).toContain('<span className="custom-field-summary-count">{filledCountLabel}</span>');
    expect(customFieldListSummary).toContain(
      'aria-label="Custom field values"',
    );
    expect(globalStyles).toContain(".custom-field-summary-count");
  });

  it("adds direct custom-field jumps from primary record workspace summaries", () => {
    for (const page of [
      dealDetail,
      contactDetail,
      organizationDetail,
      leadDetail,
    ]) {
      expect(page).toContain("RecordPanelJumpNav");
    }
    expect(recordPanelJumpNav).toContain('href: "#custom-fields" as Route');
    expect(recordPanelJumpNav).toContain("Custom fields");
  });

  it("adds supported-type custom field filtering groundwork to list pages and services", () => {
    for (const page of [dealList, contactList, organizationList, leadList]) {
      expect(page).toContain("CustomFieldFilterControls");
      expect(page).toContain("customFieldId: listState.filters.customFieldId");
      expect(page).toContain(
        "customFieldOperator: listState.filters.customFieldOperator",
      );
      expect(page).toContain(
        "customFieldValue: listState.filters.customFieldValue",
      );
    }
    expect(organizationList).toContain("organizationListStateOptions");
    expect(organizationListState).toContain('"customFieldId"');
    expect(organizationListState).toContain('"customFieldOperator"');
    expect(organizationListState).toContain('"customFieldValue"');
    expect(contactList).toContain("contactListStateOptions");
    expect(contactListState).toContain('"customFieldId"');
    expect(contactListState).toContain('"customFieldOperator"');
    expect(contactListState).toContain('"customFieldValue"');
    expect(leadList).toContain("leadListStateOptions");
    expect(leadListState).toContain('"customFieldId"');
    expect(leadListState).toContain('"customFieldOperator"');
    expect(leadListState).toContain('"customFieldValue"');
    expect(dealListState).toContain('"customFieldId"');
    expect(dealListState).toContain('"customFieldOperator"');
    expect(dealListState).toContain('"customFieldValue"');
    expect(customFieldListSummary).toContain('name="customFieldId"');
    expect(customFieldListSummary).toContain('name="customFieldOperator"');
    expect(customFieldListSummary).toContain('name="customFieldValue"');
    expect(customFieldListSummary).toContain("import { FormFieldLabel }");
    expect(customFieldListSummary).toContain(
      "<FormFieldLabel>Custom field</FormFieldLabel>",
    );
    expect(customFieldListSummary).toContain(
      "<FormFieldLabel>Custom operator</FormFieldLabel>",
    );
    expect(customFieldListSummary).toContain(
      "<FormFieldLabel>Custom value</FormFieldLabel>",
    );
    expect(customFieldListSummary).toContain("isFilterableCustomFieldType");
    expect(customFieldListSummary).toContain(
      "Filters one supported custom field. Contains is text-only; empty checks ignore this value.",
    );
    expect(customFieldDisplay).toContain("supportedCustomFieldTypes");
    expect(customFieldDisplay).toContain(
      '["TEXT", "NUMBER", "DATE", "BOOLEAN"]',
    );
    expect(customFieldDisplay).toContain("editableCustomFieldTypes");
    expect(customFieldDisplay).toContain(
      '["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]',
    );
    expect(customFieldDisplay).toContain("customFieldFilterOperators");
    expect(customFieldDisplay).toContain(
      '["equals", "contains", "is_empty", "is_not_empty"]',
    );
    expect(service).toContain("export type CustomFieldListFilters");
    expect(service).toContain("listCustomFieldFilteredEntityIds");
    expect(service).toContain(
      "normalizeOptionalCustomFieldFilterText(filterInput.customFieldId)",
    );
    expect(service).toContain(
      "normalizeOptionalCustomFieldFilterText(filterInput.customFieldValue)",
    );
    expect(service).toContain("normalizeCustomFieldFilterOperator");
    expect(service).toContain("isCustomFieldFilterOperatorAllowed");
    expect(service).toContain("isEmptyCustomFieldValue");
    expect(service).toContain("normalizeCustomFieldFilterValue");
    expect(service).toContain(
      "value: { equals: value as Prisma.InputJsonValue }",
    );
    expect(service).toContain('operator === "contains"');
    expect(service).toContain(
      'operator === "is_empty" || operator === "is_not_empty"',
    );
    expect(readme).toContain(
      "Custom field list filtering is limited to one supported custom field at a time with `equals`, text-only `contains`, `is_empty`, and `is_not_empty` operators.",
    );
    expect(apiRouteMap).toContain(
      "Browser list pages support one custom field filter at a time for supported custom field types, using `equals`, text-only `contains`, `is_empty`, and `is_not_empty`",
    );
    expect(architecture).toContain("one-field custom field filters");
    expect(readme).not.toContain(
      "Custom field list filtering is limited to one supported custom field at a time with exact-value matching.",
    );
    expect(apiRouteMap).not.toContain(
      "Browser list pages support one exact-value custom field filter at a time",
    );
    expect(architecture).not.toContain("custom field exact-value filters");
  });

  it("normalizes custom field filter operators and empty values", () => {
    expect(normalizeCustomFieldFilterOperator()).toBe("equals");
    expect(normalizeCustomFieldFilterOperator("")).toBe("equals");
    expect(normalizeCustomFieldFilterOperator(" contains ")).toBe("contains");
    expect(normalizeCustomFieldFilterOperator("before")).toBeUndefined();
    expect(
      normalizeCustomFieldFilterOperator({ operator: "contains" }),
    ).toBeUndefined();

    expect(isEditableCustomFieldType("SELECT")).toBe(true);
    expect(isFilterableCustomFieldType("SELECT")).toBe(false);
    expect(isCustomFieldFilterOperatorAllowed("TEXT", "contains")).toBe(true);
    expect(isCustomFieldFilterOperatorAllowed("NUMBER", "contains")).toBe(
      false,
    );
    expect(isCustomFieldFilterOperatorAllowed("SELECT", "equals")).toBe(false);
    expect(isCustomFieldFilterOperatorAllowed("DATE", "is_empty")).toBe(true);
    expect(isCustomFieldFilterOperatorAllowed("BOOLEAN", "equals")).toBe(true);

    expect(isEmptyCustomFieldValue(undefined)).toBe(true);
    expect(isEmptyCustomFieldValue(null)).toBe(true);
    expect(isEmptyCustomFieldValue("")).toBe(true);
    expect(isEmptyCustomFieldValue("   ")).toBe(true);
    expect(isEmptyCustomFieldValue(0)).toBe(false);
    expect(isEmptyCustomFieldValue(false)).toBe(false);
  });
});
