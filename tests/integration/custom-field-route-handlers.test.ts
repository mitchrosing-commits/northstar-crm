import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIntegrationFixture, disconnectPrisma } from "./fixtures";
import { invokeWorkspaceApi, readJson } from "./route-handler";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;
type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type CustomFieldDefinitionBody = {
  id: string;
  workspaceId: string;
  entityType: string;
  name: string;
  key: string;
  fieldType: string;
  required: boolean;
};

type DealCustomFieldBody = CustomFieldDefinitionBody & {
  values: Array<{
    entityId: string;
    value: unknown;
  }>;
};
type RecordCustomFieldBody = DealCustomFieldBody;

let fixture: Fixture | undefined;

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("database-backed custom field route handlers", () => {
  it("lists and creates Deal custom field definitions through the workspace API", async () => {
    const fx = currentFixture();

    const initialListResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-fields"]
    });
    const initialFields = await readJson<CustomFieldDefinitionBody[]>(initialListResponse);

    expect(initialListResponse.status).toBe(200);
    expect(initialFields).toEqual([]);

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-fields"],
      body: {
        entityType: "DEAL",
        name: "Decision Process",
        key: "decision_process",
        fieldType: "TEXT",
        required: false
      }
    });
    const field = await readJson<CustomFieldDefinitionBody>(createResponse);

    expect(createResponse.status).toBe(201);
    expect(field).toMatchObject({
      workspaceId: fx.workspaceA.id,
      entityType: "DEAL",
      name: "Decision Process",
      key: "decision_process",
      fieldType: "TEXT",
      required: false
    });
    expect(field.id).toEqual(expect.any(String));

    const listResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-fields"]
    });
    const fields = await readJson<CustomFieldDefinitionBody[]>(listResponse);

    expect(listResponse.status).toBe(200);
    expect(fields).toEqual([expect.objectContaining({ id: field.id, key: "decision_process" })]);
  });

  it("sets and updates Deal custom field values through the workspace API", async () => {
    const fx = currentFixture();
    const field = await createDealCustomField(fx, {
      name: "Expansion Score",
      key: "expansion_score",
      fieldType: "NUMBER"
    });

    const setResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [field.id]: 72 }
      }
    });
    const setFields = await readJson<DealCustomFieldBody[]>(setResponse);

    expect(setResponse.status).toBe(200);
    expect(valueForField(setFields, field.id)).toBe(72);

    const updateResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [field.id]: 88 }
      }
    });
    const updatedFields = await readJson<DealCustomFieldBody[]>(updateResponse);

    expect(updateResponse.status).toBe(200);
    expect(valueForField(updatedFields, field.id)).toBe(88);
  });

  it("lists, creates, and sets Contact custom fields through the workspace API", async () => {
    const fx = currentFixture();

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-fields"],
      body: {
        entityType: "PERSON",
        name: "Preferred Channel",
        key: "preferred_channel",
        fieldType: "TEXT",
        required: false
      }
    });
    const field = await readJson<CustomFieldDefinitionBody>(createResponse);

    expect(createResponse.status).toBe(201);
    expect(field).toMatchObject({
      workspaceId: fx.workspaceA.id,
      entityType: "PERSON",
      name: "Preferred Channel",
      key: "preferred_channel",
      fieldType: "TEXT"
    });

    const setResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "PERSON",
        entityId: fx.recordsA.person.id,
        values: { [field.id]: "Phone" }
      }
    });
    const setFields = await readJson<RecordCustomFieldBody[]>(setResponse);

    expect(setResponse.status).toBe(200);
    expect(valueForField(setFields, field.id)).toBe("Phone");
  });

  it("lists, creates, and sets Organization custom fields through the workspace API", async () => {
    const fx = currentFixture();

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-fields"],
      body: {
        entityType: "ORGANIZATION",
        name: "Renewal Segment",
        key: "renewal_segment",
        fieldType: "TEXT",
        required: false
      }
    });
    const field = await readJson<CustomFieldDefinitionBody>(createResponse);

    expect(createResponse.status).toBe(201);
    expect(field).toMatchObject({
      workspaceId: fx.workspaceA.id,
      entityType: "ORGANIZATION",
      name: "Renewal Segment",
      key: "renewal_segment",
      fieldType: "TEXT"
    });

    const setResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "ORGANIZATION",
        entityId: fx.recordsA.organization.id,
        values: { [field.id]: "Enterprise" }
      }
    });
    const setFields = await readJson<RecordCustomFieldBody[]>(setResponse);

    expect(setResponse.status).toBe(200);
    expect(valueForField(setFields, field.id)).toBe("Enterprise");
  });

  it("lists, creates, and sets Lead custom fields through the workspace API", async () => {
    const fx = currentFixture();

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-fields"],
      body: {
        entityType: "LEAD",
        name: "Lead Urgency",
        key: "lead_urgency",
        fieldType: "TEXT",
        required: false
      }
    });
    const field = await readJson<CustomFieldDefinitionBody>(createResponse);

    expect(createResponse.status).toBe(201);
    expect(field).toMatchObject({
      workspaceId: fx.workspaceA.id,
      entityType: "LEAD",
      name: "Lead Urgency",
      key: "lead_urgency",
      fieldType: "TEXT"
    });

    const setResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "LEAD",
        entityId: fx.recordsA.lead.id,
        values: { [field.id]: "High" }
      }
    });
    const setFields = await readJson<RecordCustomFieldBody[]>(setResponse);

    expect(setResponse.status).toBe(200);
    expect(valueForField(setFields, field.id)).toBe("High");
  });


  it("returns validation errors for invalid custom field payloads and values", async () => {
    const fx = currentFixture();

    const invalidTypeResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-fields"],
      body: {
        entityType: "DEAL",
        name: "Selection",
        key: "selection",
        fieldType: "SELECT"
      }
    });
    const invalidTypeBody = await readJson<ApiErrorBody>(invalidTypeResponse);

    expect(invalidTypeResponse.status).toBe(422);
    expect(invalidTypeBody.error.code).toBe("VALIDATION_ERROR");

    const numberField = await createDealCustomField(fx, {
      name: "Numeric Fit",
      key: "numeric_fit",
      fieldType: "NUMBER"
    });
    const invalidValueResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [numberField.id]: "not-a-number" }
      }
    });
    const invalidValueBody = await readJson<ApiErrorBody>(invalidValueResponse);

    expect(invalidValueResponse.status).toBe(422);
    expect(invalidValueBody.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects setting values for records or field definitions outside the workspace", async () => {
    const fx = currentFixture();
    const fieldA = await createDealCustomField(fx, {
      name: "Workspace A Field",
      key: "workspace_a_field",
      fieldType: "TEXT"
    });
    const fieldB = await createDealCustomField(fx, {
      workspace: "B",
      name: "Workspace B Field",
      key: "workspace_b_field",
      fieldType: "TEXT"
    });

    const crossWorkspaceDealResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsB.deal.id,
        values: { [fieldA.id]: "Should fail" }
      }
    });
    const crossWorkspaceDealBody = await readJson<ApiErrorBody>(crossWorkspaceDealResponse);

    expect(crossWorkspaceDealResponse.status).toBe(404);
    expect(crossWorkspaceDealBody.error.code).toBe("NOT_FOUND");

    const crossWorkspaceFieldResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [fieldB.id]: "Should fail" }
      }
    });
    const crossWorkspaceFieldBody = await readJson<ApiErrorBody>(crossWorkspaceFieldResponse);

    expect(crossWorkspaceFieldResponse.status).toBe(404);
    expect(crossWorkspaceFieldBody.error.code).toBe("NOT_FOUND");

    const personFieldA = await createPersonCustomField(fx, {
      name: "Contact Workspace A Field",
      key: "contact_workspace_a_field",
      fieldType: "TEXT"
    });
    const crossWorkspacePersonResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "PERSON",
        entityId: fx.recordsB.person.id,
        values: { [personFieldA.id]: "Should fail" }
      }
    });
    const crossWorkspacePersonBody = await readJson<ApiErrorBody>(crossWorkspacePersonResponse);

    expect(crossWorkspacePersonResponse.status).toBe(404);
    expect(crossWorkspacePersonBody.error.code).toBe("NOT_FOUND");

    const organizationFieldA = await createOrganizationCustomField(fx, {
      name: "Organization Workspace A Field",
      key: "organization_workspace_a_field",
      fieldType: "TEXT"
    });
    const crossWorkspaceOrganizationResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "ORGANIZATION",
        entityId: fx.recordsB.organization.id,
        values: { [organizationFieldA.id]: "Should fail" }
      }
    });
    const crossWorkspaceOrganizationBody = await readJson<ApiErrorBody>(crossWorkspaceOrganizationResponse);

    expect(crossWorkspaceOrganizationResponse.status).toBe(404);
    expect(crossWorkspaceOrganizationBody.error.code).toBe("NOT_FOUND");

    const leadFieldA = await createLeadCustomField(fx, {
      name: "Lead Workspace A Field",
      key: "lead_workspace_a_field",
      fieldType: "TEXT"
    });
    const crossWorkspaceLeadResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "LEAD",
        entityId: fx.recordsB.lead.id,
        values: { [leadFieldA.id]: "Should fail" }
      }
    });
    const crossWorkspaceLeadBody = await readJson<ApiErrorBody>(crossWorkspaceLeadResponse);

    expect(crossWorkspaceLeadResponse.status).toBe(404);
    expect(crossWorkspaceLeadBody.error.code).toBe("NOT_FOUND");
  });

  it("rejects setting Lead custom field values on converted leads", async () => {
    const fx = currentFixture();
    const leadField = await createLeadCustomField(fx, {
      name: "Converted Lock Field",
      key: "converted_lock_field",
      fieldType: "TEXT"
    });
    await fx.prisma.lead.update({
      where: { id: fx.recordsA.lead.id },
      data: { status: "CONVERTED" }
    });

    const response = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "LEAD",
        entityId: fx.recordsA.lead.id,
        values: { [leadField.id]: "Should fail" }
      }
    });
    const body = await readJson<ApiErrorBody>(response);

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("LEAD_CONVERTED");
  });

  it("rejects custom field values when the field entity type does not match the target entity type", async () => {
    const fx = currentFixture();
    const dealField = await createDealCustomField(fx, {
      name: "Deal Only",
      key: "deal_only",
      fieldType: "TEXT"
    });
    const personField = await createPersonCustomField(fx, {
      name: "Contact Only",
      key: "contact_only",
      fieldType: "TEXT"
    });
    const organizationField = await createOrganizationCustomField(fx, {
      name: "Organization Only",
      key: "organization_only",
      fieldType: "TEXT"
    });
    const leadField = await createLeadCustomField(fx, {
      name: "Lead Only",
      key: "lead_only",
      fieldType: "TEXT"
    });

    const dealFieldOnPersonResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "PERSON",
        entityId: fx.recordsA.person.id,
        values: { [dealField.id]: "Should fail" }
      }
    });
    const dealFieldOnPersonBody = await readJson<ApiErrorBody>(dealFieldOnPersonResponse);

    expect(dealFieldOnPersonResponse.status).toBe(404);
    expect(dealFieldOnPersonBody.error.code).toBe("NOT_FOUND");

    const personFieldOnDealResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [personField.id]: "Should fail" }
      }
    });
    const personFieldOnDealBody = await readJson<ApiErrorBody>(personFieldOnDealResponse);

    expect(personFieldOnDealResponse.status).toBe(404);
    expect(personFieldOnDealBody.error.code).toBe("NOT_FOUND");

    const dealFieldOnOrganizationResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "ORGANIZATION",
        entityId: fx.recordsA.organization.id,
        values: { [dealField.id]: "Should fail" }
      }
    });
    const dealFieldOnOrganizationBody = await readJson<ApiErrorBody>(dealFieldOnOrganizationResponse);

    expect(dealFieldOnOrganizationResponse.status).toBe(404);
    expect(dealFieldOnOrganizationBody.error.code).toBe("NOT_FOUND");

    const personFieldOnOrganizationResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "ORGANIZATION",
        entityId: fx.recordsA.organization.id,
        values: { [personField.id]: "Should fail" }
      }
    });
    const personFieldOnOrganizationBody = await readJson<ApiErrorBody>(personFieldOnOrganizationResponse);

    expect(personFieldOnOrganizationResponse.status).toBe(404);
    expect(personFieldOnOrganizationBody.error.code).toBe("NOT_FOUND");

    const organizationFieldOnDealResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [organizationField.id]: "Should fail" }
      }
    });
    const organizationFieldOnDealBody = await readJson<ApiErrorBody>(organizationFieldOnDealResponse);

    expect(organizationFieldOnDealResponse.status).toBe(404);
    expect(organizationFieldOnDealBody.error.code).toBe("NOT_FOUND");

    const organizationFieldOnPersonResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "PERSON",
        entityId: fx.recordsA.person.id,
        values: { [organizationField.id]: "Should fail" }
      }
    });
    const organizationFieldOnPersonBody = await readJson<ApiErrorBody>(organizationFieldOnPersonResponse);

    expect(organizationFieldOnPersonResponse.status).toBe(404);
    expect(organizationFieldOnPersonBody.error.code).toBe("NOT_FOUND");

    const dealFieldOnLeadResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "LEAD",
        entityId: fx.recordsA.lead.id,
        values: { [dealField.id]: "Should fail" }
      }
    });
    const dealFieldOnLeadBody = await readJson<ApiErrorBody>(dealFieldOnLeadResponse);

    expect(dealFieldOnLeadResponse.status).toBe(404);
    expect(dealFieldOnLeadBody.error.code).toBe("NOT_FOUND");

    const personFieldOnLeadResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "LEAD",
        entityId: fx.recordsA.lead.id,
        values: { [personField.id]: "Should fail" }
      }
    });
    const personFieldOnLeadBody = await readJson<ApiErrorBody>(personFieldOnLeadResponse);

    expect(personFieldOnLeadResponse.status).toBe(404);
    expect(personFieldOnLeadBody.error.code).toBe("NOT_FOUND");

    const organizationFieldOnLeadResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "LEAD",
        entityId: fx.recordsA.lead.id,
        values: { [organizationField.id]: "Should fail" }
      }
    });
    const organizationFieldOnLeadBody = await readJson<ApiErrorBody>(organizationFieldOnLeadResponse);

    expect(organizationFieldOnLeadResponse.status).toBe(404);
    expect(organizationFieldOnLeadBody.error.code).toBe("NOT_FOUND");

    const leadFieldOnDealResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [leadField.id]: "Should fail" }
      }
    });
    const leadFieldOnDealBody = await readJson<ApiErrorBody>(leadFieldOnDealResponse);

    expect(leadFieldOnDealResponse.status).toBe(404);
    expect(leadFieldOnDealBody.error.code).toBe("NOT_FOUND");

    const leadFieldOnPersonResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "PERSON",
        entityId: fx.recordsA.person.id,
        values: { [leadField.id]: "Should fail" }
      }
    });
    const leadFieldOnPersonBody = await readJson<ApiErrorBody>(leadFieldOnPersonResponse);

    expect(leadFieldOnPersonResponse.status).toBe(404);
    expect(leadFieldOnPersonBody.error.code).toBe("NOT_FOUND");

    const leadFieldOnOrganizationResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values"],
      body: {
        entityType: "ORGANIZATION",
        entityId: fx.recordsA.organization.id,
        values: { [leadField.id]: "Should fail" }
      }
    });
    const leadFieldOnOrganizationBody = await readJson<ApiErrorBody>(leadFieldOnOrganizationResponse);

    expect(leadFieldOnOrganizationResponse.status).toBe(404);
    expect(leadFieldOnOrganizationBody.error.code).toBe("NOT_FOUND");
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not created.");
  return fixture;
}

async function createDealCustomField(
  fx: Fixture,
  input: {
    workspace?: "A" | "B";
    name: string;
    key: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  }
) {
  return createCustomField(fx, { ...input, entityType: "DEAL" });
}

async function createPersonCustomField(
  fx: Fixture,
  input: {
    workspace?: "A" | "B";
    name: string;
    key: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  }
) {
  return createCustomField(fx, { ...input, entityType: "PERSON" });
}

async function createOrganizationCustomField(
  fx: Fixture,
  input: {
    workspace?: "A" | "B";
    name: string;
    key: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  }
) {
  return createCustomField(fx, { ...input, entityType: "ORGANIZATION" });
}

async function createLeadCustomField(
  fx: Fixture,
  input: {
    workspace?: "A" | "B";
    name: string;
    key: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  }
) {
  return createCustomField(fx, { ...input, entityType: "LEAD" });
}

async function createCustomField(
  fx: Fixture,
  input: {
    workspace?: "A" | "B";
    entityType: "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";
    name: string;
    key: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  }
) {
  const workspaceId = input.workspace === "B" ? fx.workspaceB.id : fx.workspaceA.id;
  const actorUserId = input.workspace === "B" ? fx.userB.id : fx.userA.id;
  const response = await invokeWorkspaceApi({
    method: "POST",
    workspaceId,
    actorUserId,
    segments: ["custom-fields"],
    body: {
      entityType: input.entityType,
      name: input.name,
      key: input.key,
      fieldType: input.fieldType
    }
  });

  expect(response.status).toBe(201);
  return readJson<CustomFieldDefinitionBody>(response);
}

function valueForField(fields: DealCustomFieldBody[], fieldId: string) {
  const field = fields.find((candidate) => candidate.id === fieldId);
  return field?.values[0]?.value;
}
