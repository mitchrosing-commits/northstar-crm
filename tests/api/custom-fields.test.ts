import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isCustomFieldFilterOperatorAllowed,
  isEmptyCustomFieldValue,
  normalizeCustomFieldFilterOperator
} from "@/lib/custom-field-display";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const validators = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/services/custom-field-service.ts"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const adminPage = readFileSync(join(process.cwd(), "app/custom-fields/page.tsx"), "utf8");
const definitionForm = readFileSync(join(process.cwd(), "components/custom-field-definition-form.tsx"), "utf8");
const dealDetail = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const contactDetail = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationDetail = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const leadDetail = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const dealList = readFileSync(join(process.cwd(), "app/deals/page.tsx"), "utf8");
const contactListState = readFileSync(join(process.cwd(), "lib/contact-list-state.ts"), "utf8");
const dealListState = readFileSync(join(process.cwd(), "lib/deal-list-state.ts"), "utf8");
const leadListState = readFileSync(join(process.cwd(), "lib/lead-list-state.ts"), "utf8");
const organizationListState = readFileSync(join(process.cwd(), "lib/organization-list-state.ts"), "utf8");
const contactList = readFileSync(join(process.cwd(), "app/contacts/page.tsx"), "utf8");
const organizationList = readFileSync(join(process.cwd(), "app/organizations/page.tsx"), "utf8");
const leadList = readFileSync(join(process.cwd(), "app/leads/page.tsx"), "utf8");
const recordCustomFieldsForm = readFileSync(join(process.cwd(), "components/record-custom-fields-form.tsx"), "utf8");
const customFieldListSummary = readFileSync(join(process.cwd(), "components/custom-field-list-summary.tsx"), "utf8");
const customFieldDisplay = readFileSync(join(process.cwd(), "lib/custom-field-display.ts"), "utf8");

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
    expect(route).toContain("resource === \"custom-field-values\"");
    expect(route).toContain("upsertCustomFieldValuesSchema.parse");
    expect(route).toContain("upsertCustomFieldValues(actor");
    expect(validators).toContain("entityType: z.enum([\"DEAL\", \"PERSON\", \"ORGANIZATION\", \"LEAD\"])");
    expect(validators).toContain("fieldType: z.enum([\"TEXT\", \"NUMBER\", \"DATE\", \"BOOLEAN\"])");
    expect(validators).toContain("export const upsertCustomFieldValuesSchema");
  });

  it("keeps custom fields workspace-scoped, entity-scoped, validated, and audited", () => {
    expect(service).toContain("ensureWorkspaceAccess(actor)");
    expect(service).toContain("UNSUPPORTED_CUSTOM_FIELD_ENTITY");
    expect(service).toContain("assertRecordInWorkspace(recordModel(data.entityType)");
    expect(service).toContain("function recordModel(entityType: EditableCustomFieldEntityType)");
    expect(service).toContain("listPersonCustomFields");
    expect(service).toContain("listOrganizationCustomFields");
    expect(service).toContain("listLeadCustomFields");
    expect(service).toContain("assertLeadCustomFieldsEditable");
    expect(service).toContain("LEAD_CONVERTED");
    expect(service).toContain("return \"organization\"");
    expect(service).toContain("return \"lead\"");
    expect(service).toContain("where: { workspaceId: actor.workspaceId, entityType: data.entityType");
    expect(service).toContain("normalizeCustomFieldValue");
    expect(service).toContain("field.required");
    expect(service).toContain("entityType: data.entityType");
    expect(service).toContain("custom_field.created");
    expect(service).toContain("custom_field_value.updated");
  });

  it("adds a custom fields admin page for Deal, Contact, Organization, and Lead fields", () => {
    expect(primaryNav).toContain("href: \"/custom-fields\"");
    expect(adminPage).toContain("CustomFieldDefinitionForm");
    expect(adminPage).toContain("listCustomFields");
    expect(adminPage).toContain("Deal Fields");
    expect(adminPage).toContain("Contact Fields");
    expect(adminPage).toContain("Organization Fields");
    expect(adminPage).toContain("Lead Fields");
    expect(definitionForm).toContain("Applies to");
    expect(definitionForm).toContain("[\"PERSON\", \"Contact\"]");
    expect(definitionForm).toContain("[\"ORGANIZATION\", \"Organization\"]");
    expect(definitionForm).toContain("[\"LEAD\", \"Lead\"]");
    expect(definitionForm).toContain("/api/v1/workspaces/${workspaceId}/custom-fields");
    expect(definitionForm).toContain("slugKey");
  });

  it("renders and edits deal custom field values from the deal detail page", () => {
    expect(dealDetail).toContain("listDealCustomFields(actor, deal.id)");
    expect(dealDetail).toContain("DealCustomFieldsForm");
    expect(dealDetail).toContain("Custom Fields");
    expect(recordCustomFieldsForm).toContain("/api/v1/workspaces/${workspaceId}/custom-field-values");
    expect(recordCustomFieldsForm).toContain("entityType=\"DEAL\"");
    expect(recordCustomFieldsForm).toContain("editableTypes");
    expect(recordCustomFieldsForm).toContain("Custom fields are ready, but no values have been filled in yet.");
    expect(recordCustomFieldsForm).toContain("custom-field-readonly");
    expect(recordCustomFieldsForm).toContain("\"TEXT\", \"NUMBER\", \"DATE\", \"BOOLEAN\", \"SELECT\"");
    expect(recordCustomFieldsForm).toContain("selectOptions(field.options)");
    expect(service).toContain("field.fieldType === \"SELECT\"");
    expect(service).toContain("must be one of the configured options");
  });

  it("renders and edits contact custom field values from the contact detail page", () => {
    expect(contactDetail).toContain("listPersonCustomFields(actor, person.id)");
    expect(contactDetail).toContain("RecordCustomFieldsForm");
    expect(contactDetail).toContain("entityType=\"PERSON\"");
    expect(contactDetail).toContain("No contact custom fields have been created yet.");
    expect(recordCustomFieldsForm).toContain("export function RecordCustomFieldsForm");
    expect(recordCustomFieldsForm).toContain("entityType,");
  });

  it("renders and edits organization custom field values from the organization detail page", () => {
    expect(organizationDetail).toContain("listOrganizationCustomFields(actor, organization.id)");
    expect(organizationDetail).toContain("RecordCustomFieldsForm");
    expect(organizationDetail).toContain("entityType=\"ORGANIZATION\"");
    expect(organizationDetail).toContain("No organization custom fields have been created yet.");
    expect(recordCustomFieldsForm).toContain("type EntityType = \"DEAL\" | \"PERSON\" | \"ORGANIZATION\" | \"LEAD\"");
  });

  it("renders and edits lead custom field values from the lead detail page when unconverted", () => {
    expect(leadDetail).toContain("listLeadCustomFields(actor, lead.id)");
    expect(leadDetail).toContain("RecordCustomFieldsForm");
    expect(leadDetail).toContain("entityType=\"LEAD\"");
    expect(leadDetail).toContain("No lead custom fields have been created yet.");
  });

  it("renders lead custom field values read-only when the lead is converted", () => {
    expect(leadDetail).toContain("RecordCustomFieldsReadOnly");
    expect(leadDetail).toContain("lead.status === \"CONVERTED\"");
    expect(leadDetail).toContain("This lead has been converted. Custom fields are read-only.");
    expect(recordCustomFieldsForm).toContain("No custom field values have been filled in yet.");
  });

  it("shows compact custom field summaries on Deal, Contact, Organization, and Lead list pages", () => {
    for (const page of [dealList, contactList, organizationList, leadList]) {
      expect(page).toContain("CustomFieldSummaryCell");
      expect(page).toContain("listCustomFieldSummaries");
      expect(page).toContain("<th>Custom fields</th>");
    }
    expect(dealList).toContain("listCustomFields(actor, { entityType: \"DEAL\" })");
    expect(contactList).toContain("listCustomFields(actor, { entityType: \"PERSON\" })");
    expect(organizationList).toContain("listCustomFields(actor, { entityType: \"ORGANIZATION\" })");
    expect(leadList).toContain("listCustomFields(actor, { entityType: \"LEAD\" })");
    expect(customFieldListSummary).toContain("None configured");
    expect(customFieldListSummary).toContain("None filled");
    expect(customFieldListSummary).toContain("Read-only");
    expect(customFieldListSummary).toContain("isSupportedCustomFieldType");
  });

  it("adds supported-type custom field filtering groundwork to list pages and services", () => {
    for (const page of [dealList, contactList, organizationList, leadList]) {
      expect(page).toContain("CustomFieldFilterControls");
      expect(page).toContain("customFieldId: listState.filters.customFieldId");
      expect(page).toContain("customFieldOperator: listState.filters.customFieldOperator");
      expect(page).toContain("customFieldValue: listState.filters.customFieldValue");
    }
    expect(organizationList).toContain("organizationListStateOptions");
    expect(organizationListState).toContain("\"customFieldId\"");
    expect(organizationListState).toContain("\"customFieldOperator\"");
    expect(organizationListState).toContain("\"customFieldValue\"");
    expect(contactList).toContain("contactListStateOptions");
    expect(contactListState).toContain("\"customFieldId\"");
    expect(contactListState).toContain("\"customFieldOperator\"");
    expect(contactListState).toContain("\"customFieldValue\"");
    expect(leadList).toContain("leadListStateOptions");
    expect(leadListState).toContain("\"customFieldId\"");
    expect(leadListState).toContain("\"customFieldOperator\"");
    expect(leadListState).toContain("\"customFieldValue\"");
    expect(dealListState).toContain("\"customFieldId\"");
    expect(dealListState).toContain("\"customFieldOperator\"");
    expect(dealListState).toContain("\"customFieldValue\"");
    expect(customFieldListSummary).toContain("name=\"customFieldId\"");
    expect(customFieldListSummary).toContain("name=\"customFieldOperator\"");
    expect(customFieldListSummary).toContain("name=\"customFieldValue\"");
    expect(customFieldListSummary).toContain("Filters one supported custom field. Contains is text-only; empty checks ignore this value.");
    expect(customFieldDisplay).toContain("supportedCustomFieldTypes");
    expect(customFieldDisplay).toContain("[\"TEXT\", \"NUMBER\", \"DATE\", \"BOOLEAN\"]");
    expect(customFieldDisplay).toContain("customFieldFilterOperators");
    expect(customFieldDisplay).toContain("[\"equals\", \"contains\", \"is_empty\", \"is_not_empty\"]");
    expect(service).toContain("export type CustomFieldListFilters");
    expect(service).toContain("listCustomFieldFilteredEntityIds");
    expect(service).toContain("normalizeCustomFieldFilterOperator");
    expect(service).toContain("isCustomFieldFilterOperatorAllowed");
    expect(service).toContain("isEmptyCustomFieldValue");
    expect(service).toContain("normalizeCustomFieldFilterValue");
    expect(service).toContain("value: { equals: value as Prisma.InputJsonValue }");
    expect(service).toContain("operator === \"contains\"");
    expect(service).toContain("operator === \"is_empty\" || operator === \"is_not_empty\"");
  });

  it("normalizes custom field filter operators and empty values", () => {
    expect(normalizeCustomFieldFilterOperator()).toBe("equals");
    expect(normalizeCustomFieldFilterOperator("")).toBe("equals");
    expect(normalizeCustomFieldFilterOperator(" contains ")).toBe("contains");
    expect(normalizeCustomFieldFilterOperator("before")).toBeUndefined();

    expect(isCustomFieldFilterOperatorAllowed("TEXT", "contains")).toBe(true);
    expect(isCustomFieldFilterOperatorAllowed("NUMBER", "contains")).toBe(false);
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
