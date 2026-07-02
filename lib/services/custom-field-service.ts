import { CustomFieldType, Prisma, type CustomFieldDefinition } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import {
  isCustomFieldFilterOperatorAllowed,
  isEmptyCustomFieldValue,
  isFilterableCustomFieldType,
  normalizeCustomFieldFilterOperator,
  normalizeCustomFieldFilterValue
} from "@/lib/custom-field-display";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertRecordInWorkspace } from "./record-guards";

type EditableCustomFieldEntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";
export type CustomFieldListFilters = {
  customFieldId?: unknown;
  customFieldOperator?: unknown;
  customFieldValue?: unknown;
};
export type CustomFieldSummaryField = {
  id: string;
  name: string;
  key: string;
  fieldType: CustomFieldType;
  required: boolean;
  value: unknown;
};

export async function listCustomFields(actor: WorkspaceActor, filters: unknown = {}) {
  await ensureWorkspaceAccess(actor);
  const filterInput = objectInput(filters);
  const where: Prisma.CustomFieldDefinitionWhereInput = { workspaceId: actor.workspaceId, ...activeWhere };
  if (filterInput.entityType) where.entityType = normalizeCustomFieldEntityType(filterInput.entityType);

  return prisma.customFieldDefinition.findMany({
    where,
    orderBy: [{ entityType: "asc" }, { name: "asc" }]
  });
}

export async function createCustomField(actor: WorkspaceActor, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const input = objectInput(data);
  const entityType = normalizeCustomFieldEntityType(input.entityType);
  const fieldType = normalizeCustomFieldType(input.fieldType);
  const fieldData = normalizeCustomFieldDefinitionInput(input, fieldType);

  const existingField = await prisma.customFieldDefinition.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      entityType,
      key: fieldData.key
    },
    select: { id: true }
  });

  if (existingField) throw duplicateCustomFieldError();

  let field: CustomFieldDefinition;
  try {
    field = await prisma.customFieldDefinition.create({
      data: {
        ...fieldData,
        entityType,
        fieldType,
        workspaceId: actor.workspaceId,
        options: fieldData.options === null ? Prisma.JsonNull : fieldData.options
      }
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw duplicateCustomFieldError();
    }
    throw error;
  }
  await writeAuditLog(actor, "custom_field.created", "CustomFieldDefinition", field.id, {
    key: field.key,
    entityType: field.entityType
  });
  return field;
}

export async function listDealCustomFields(actor: WorkspaceActor, dealId: string) {
  return listRecordCustomFields(actor, "DEAL", dealId);
}

export async function listPersonCustomFields(actor: WorkspaceActor, personId: string) {
  return listRecordCustomFields(actor, "PERSON", personId);
}

export async function listOrganizationCustomFields(actor: WorkspaceActor, organizationId: string) {
  return listRecordCustomFields(actor, "ORGANIZATION", organizationId);
}

export async function listLeadCustomFields(actor: WorkspaceActor, leadId: string) {
  return listRecordCustomFields(actor, "LEAD", leadId);
}

export async function listRecordCustomFields(actor: WorkspaceActor, entityType: EditableCustomFieldEntityType, entityId: string) {
  await ensureWorkspaceAccess(actor);
  const normalizedEntityType = normalizeCustomFieldEntityType(entityType);
  await assertRecordInWorkspace(recordModel(normalizedEntityType), actor.workspaceId, entityId);

  return prisma.customFieldDefinition.findMany({
    where: { workspaceId: actor.workspaceId, entityType: normalizedEntityType, ...activeWhere },
    include: {
      values: {
        where: { workspaceId: actor.workspaceId, entityType: normalizedEntityType, entityId },
        take: 1
      }
    },
    orderBy: { name: "asc" }
  });
}

export async function listCustomFieldSummaries(
  actor: WorkspaceActor,
  entityType: EditableCustomFieldEntityType,
  entityIds: string[]
) {
  await ensureWorkspaceAccess(actor);
  const normalizedEntityType = normalizeCustomFieldEntityType(entityType);
  const requestedEntityIds = Array.from(new Set(entityIds)).filter(
    (entityId): entityId is string => typeof entityId === "string" && entityId.trim().length > 0
  );
  if (requestedEntityIds.length === 0) return new Map<string, CustomFieldSummaryField[]>();

  const [fields, visibleEntityIds] = await Promise.all([
    prisma.customFieldDefinition.findMany({
      where: { workspaceId: actor.workspaceId, entityType: normalizedEntityType, ...activeWhere },
      orderBy: { name: "asc" }
    }),
    listActiveCustomFieldEntityIdsForIds(actor.workspaceId, normalizedEntityType, requestedEntityIds)
  ]);

  const summaries = new Map<string, CustomFieldSummaryField[]>(
    visibleEntityIds.map((entityId) => [entityId, fields.map((field) => ({ ...summaryField(field), value: null }))])
  );

  if (fields.length === 0 || visibleEntityIds.length === 0) return summaries;

  const values = await prisma.customFieldValue.findMany({
    where: {
      workspaceId: actor.workspaceId,
      entityType: normalizedEntityType,
      entityId: { in: visibleEntityIds },
      fieldId: { in: fields.map((field) => field.id) }
    },
    select: { entityId: true, fieldId: true, value: true }
  });
  const valuesByEntityAndField = new Map(values.map((value) => [`${value.entityId}:${value.fieldId}`, value.value]));

  for (const entityId of visibleEntityIds) {
    summaries.set(
      entityId,
      fields.map((field) => ({
        ...summaryField(field),
        value: valuesByEntityAndField.get(`${entityId}:${field.id}`) ?? null
      }))
    );
  }

  return summaries;
}

async function listActiveCustomFieldEntityIdsForIds(
  workspaceId: string,
  entityType: EditableCustomFieldEntityType,
  entityIds: string[]
) {
  const normalizedEntityType = normalizeCustomFieldEntityType(entityType);
  const where = { id: { in: entityIds }, workspaceId, ...activeWhere };
  if (normalizedEntityType === "DEAL") {
    const rows = await prisma.deal.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  if (normalizedEntityType === "PERSON") {
    const rows = await prisma.person.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  if (normalizedEntityType === "LEAD") {
    const rows = await prisma.lead.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  const rows = await prisma.organization.findMany({ where, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function listCustomFieldFilteredEntityIds(
  workspaceId: string,
  entityType: EditableCustomFieldEntityType,
  filters: unknown
) {
  const normalizedEntityType = normalizeCustomFieldEntityType(entityType);
  const filterInput = objectInput(filters);
  const fieldId = normalizeOptionalCustomFieldFilterText(filterInput.customFieldId);
  const rawValue = normalizeOptionalCustomFieldFilterText(filterInput.customFieldValue);
  if (!fieldId) return undefined;

  const operator = normalizeCustomFieldFilterOperator(filterInput.customFieldOperator);
  if (!operator) return [];
  if ((operator === "equals" || operator === "contains") && !rawValue) return undefined;
  const valueText = rawValue ?? "";

  const field = await prisma.customFieldDefinition.findFirst({
    where: { id: fieldId, workspaceId, entityType: normalizedEntityType, ...activeWhere },
    select: { id: true, fieldType: true }
  });

  if (!field || !isFilterableCustomFieldType(field.fieldType)) return [];
  if (!isCustomFieldFilterOperatorAllowed(field.fieldType, operator)) return [];

  if (operator === "is_empty" || operator === "is_not_empty") {
    const [entityIds, values] = await Promise.all([
      listActiveCustomFieldEntityIds(workspaceId, normalizedEntityType),
      prisma.customFieldValue.findMany({
        where: { workspaceId, entityType: normalizedEntityType, fieldId },
        select: { entityId: true, value: true }
      })
    ]);
    const valuesByEntityId = new Map(values.map((value) => [value.entityId, value.value]));
    return entityIds.filter((entityId) => {
      const isEmpty = !valuesByEntityId.has(entityId) || isEmptyCustomFieldValue(valuesByEntityId.get(entityId));
      return operator === "is_empty" ? isEmpty : !isEmpty;
    });
  }

  if (operator === "contains") {
    const matches = await prisma.customFieldValue.findMany({
      where: { workspaceId, entityType: normalizedEntityType, fieldId },
      select: { entityId: true, value: true }
    });
    const needle = valueText.toLowerCase();
    return matches
      .filter((match) => typeof match.value === "string" && match.value.toLowerCase().includes(needle))
      .map((match) => match.entityId);
  }

  const value = normalizeCustomFieldFilterValue(field.fieldType, valueText);
  if (value === undefined) return [];

  const matches = await prisma.customFieldValue.findMany({
    where: {
      workspaceId,
      entityType: normalizedEntityType,
      fieldId,
      value: { equals: value as Prisma.InputJsonValue }
    },
    select: { entityId: true }
  });

  return matches.map((match) => match.entityId);
}

function normalizeOptionalCustomFieldFilterText(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

async function listActiveCustomFieldEntityIds(workspaceId: string, entityType: EditableCustomFieldEntityType) {
  const normalizedEntityType = normalizeCustomFieldEntityType(entityType);
  const where = { workspaceId, ...activeWhere };
  if (normalizedEntityType === "DEAL") {
    const rows = await prisma.deal.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  if (normalizedEntityType === "PERSON") {
    const rows = await prisma.person.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  if (normalizedEntityType === "LEAD") {
    const rows = await prisma.lead.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  const rows = await prisma.organization.findMany({ where, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function upsertDealCustomFieldValues(
  actor: WorkspaceActor,
  data: unknown
) {
  return upsertCustomFieldValues(actor, { ...objectInput(data), entityType: "DEAL" });
}

export async function upsertCustomFieldValues(
  actor: WorkspaceActor,
  data: unknown
) {
  await ensureWorkspaceAccess(actor);
  const input = objectInput(data);
  const entityType = normalizeCustomFieldEntityType(input.entityType);
  const entityId = normalizeCustomFieldRecordId(input.entityId);
  const values = normalizeCustomFieldValuesInput(input.values);
  await assertRecordInWorkspace(recordModel(entityType), actor.workspaceId, entityId);
  if (entityType === "DEAL") await assertDealCustomFieldsEditable(actor.workspaceId, entityId);
  if (entityType === "LEAD") await assertLeadCustomFieldsEditable(actor.workspaceId, entityId);

  const fields = await prisma.customFieldDefinition.findMany({
    where: { workspaceId: actor.workspaceId, entityType, ...activeWhere }
  });
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const updates = Object.entries(values);
  const normalizedUpdates = updates.map(([fieldId, rawValue]) => {
    const field = fieldsById.get(fieldId);
    if (!field) throw new ApiError("NOT_FOUND", "Custom field was not found.", 404);
    return { fieldId, value: normalizeCustomFieldValue(field, rawValue) };
  });

  if (normalizedUpdates.length === 0) {
    return listRecordCustomFields(actor, entityType, entityId);
  }

  const existingValues = await prisma.customFieldValue.findMany({
    where: {
      workspaceId: actor.workspaceId,
      entityType,
      entityId,
      fieldId: { in: normalizedUpdates.map(({ fieldId }) => fieldId) }
    },
    select: { fieldId: true, value: true }
  });
  const existingValuesByFieldId = new Map(existingValues.map((value) => [value.fieldId, value.value]));
  const changedUpdates = normalizedUpdates.filter(({ fieldId, value }) => {
    if (!existingValuesByFieldId.has(fieldId)) return true;
    return !customFieldJsonValuesEqual(existingValuesByFieldId.get(fieldId) ?? null, value);
  });

  if (changedUpdates.length === 0) {
    return listRecordCustomFields(actor, entityType, entityId);
  }

  await prisma.$transaction(
    changedUpdates.map(({ fieldId, value }) =>
      prisma.customFieldValue.upsert({
        where: { fieldId_entityId: { fieldId, entityId } },
        update: { workspaceId: actor.workspaceId, entityType, value },
        create: {
          workspaceId: actor.workspaceId,
          fieldId,
          entityType,
          entityId,
          value
        }
      })
    )
  );

  await writeAuditLog(actor, "custom_field_value.updated", auditEntityType(entityType), entityId, {
    entityType,
    fieldIds: changedUpdates.map(({ fieldId }) => fieldId)
  });

  return listRecordCustomFields(actor, entityType, entityId);
}

function customFieldJsonValuesEqual(current: Prisma.JsonValue, next: unknown) {
  if (current === null && Object.is(next, Prisma.JsonNull)) return true;
  return JSON.stringify(current) === JSON.stringify(next);
}

function normalizeCustomFieldValue(
  field: { name: string; fieldType: CustomFieldType; required: boolean; options: Prisma.JsonValue },
  rawValue: unknown
) {
  const trimmedStringValue = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  const isBlank = rawValue === null || rawValue === undefined || trimmedStringValue === "";
  if (isBlank) {
    if (field.required) throw new ApiError("VALIDATION_ERROR", `${field.name} is required.`, 422);
    return Prisma.JsonNull;
  }

  if (field.fieldType === "TEXT") {
    return String(rawValue);
  }

  if (field.fieldType === "NUMBER") {
    const value = typeof trimmedStringValue === "number" ? trimmedStringValue : Number(trimmedStringValue);
    if (!Number.isFinite(value)) throw new ApiError("VALIDATION_ERROR", `${field.name} must be a number.`, 422);
    return value;
  }

  if (field.fieldType === "DATE") {
    const value = String(trimmedStringValue);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ApiError("VALIDATION_ERROR", `${field.name} must be a date.`, 422);
    }
    return value;
  }

  if (field.fieldType === "BOOLEAN") {
    if (typeof rawValue === "boolean") return rawValue;
    if (trimmedStringValue === "true") return true;
    if (trimmedStringValue === "false") return false;
    throw new ApiError("VALIDATION_ERROR", `${field.name} must be true or false.`, 422);
  }

  if (field.fieldType === "SELECT") {
    const value = String(trimmedStringValue);
    const options = customFieldSelectOptions(field.options);
    if (options.length > 0 && !options.includes(value)) {
      throw new ApiError("VALIDATION_ERROR", `${field.name} must be one of the configured options.`, 422);
    }
    return value;
  }

  throw new ApiError("UNSUPPORTED_CUSTOM_FIELD_TYPE", `${field.name} cannot be edited in this form yet.`, 422);
}

function customFieldSelectOptions(options: Prisma.JsonValue) {
  return Array.isArray(options) ? options.filter((option): option is string => typeof option === "string") : [];
}

function normalizeCustomFieldEntityType(value: unknown): EditableCustomFieldEntityType {
  if (value === "DEAL" || value === "PERSON" || value === "ORGANIZATION" || value === "LEAD") return value;
  throw new ApiError("VALIDATION_ERROR", "Custom field entity type must be DEAL, PERSON, ORGANIZATION, or LEAD.", 422);
}

function normalizeCustomFieldType(value: unknown): CustomFieldType {
  if (value === "TEXT" || value === "NUMBER" || value === "DATE" || value === "BOOLEAN" || value === "SELECT") {
    return value;
  }
  throw new ApiError("VALIDATION_ERROR", "Custom field type must be TEXT, NUMBER, DATE, BOOLEAN, or SELECT.", 422);
}

function normalizeCustomFieldDefinitionInput(data: Record<string, unknown>, fieldType: CustomFieldType) {
  return {
    name: normalizeCustomFieldDefinitionName(data.name),
    key: normalizeCustomFieldDefinitionKey(data.key),
    required: normalizeOptionalCustomFieldRequired(data.required),
    options: normalizeCustomFieldOptions(data.options, fieldType)
  };
}

function normalizeCustomFieldRecordId(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Custom field record id must be text.", 422);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_ERROR", "Custom field record id must be text.", 422);
  }
  return trimmed;
}

function normalizeCustomFieldValuesInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ApiError("VALIDATION_ERROR", "Custom field values must be an object.", 422);
}

function objectInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function normalizeCustomFieldDefinitionName(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Custom field name is required.", 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", "Custom field name is required.", 422);
  return trimmed;
}

function normalizeCustomFieldDefinitionKey(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Custom field key must use lowercase letters, numbers, and underscores.", 422);
  }
  const trimmed = value.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
    throw new ApiError("VALIDATION_ERROR", "Custom field key must use lowercase letters, numbers, and underscores.", 422);
  }
  return trimmed;
}

function normalizeOptionalCustomFieldRequired(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new ApiError("VALIDATION_ERROR", "Custom field required flag must be true or false.", 422);
}

function normalizeCustomFieldOptions(value: unknown, fieldType: CustomFieldType): Prisma.InputJsonValue | null {
  if (fieldType !== "SELECT") return null;
  if (!Array.isArray(value)) {
    throw new ApiError("VALIDATION_ERROR", "Select custom fields require at least one option.", 422);
  }

  const options = Array.from(
    new Set(value.filter((option): option is string => typeof option === "string").map((option) => option.trim()))
  ).filter(Boolean);

  if (options.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "Select custom fields require at least one option.", 422);
  }

  return options;
}

function recordModel(entityType: EditableCustomFieldEntityType) {
  if (entityType === "DEAL") return "deal";
  if (entityType === "PERSON") return "person";
  if (entityType === "LEAD") return "lead";
  return "organization";
}

function auditEntityType(entityType: EditableCustomFieldEntityType) {
  if (entityType === "DEAL") return "Deal";
  if (entityType === "PERSON") return "Person";
  if (entityType === "LEAD") return "Lead";
  return "Organization";
}

function summaryField(field: {
  id: string;
  name: string;
  key: string;
  fieldType: CustomFieldType;
  required: boolean;
}) {
  return {
    id: field.id,
    name: field.name,
    key: field.key,
    fieldType: field.fieldType,
    required: field.required
  };
}

async function assertLeadCustomFieldsEditable(workspaceId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId, ...activeWhere },
    select: { status: true }
  });

  if (!lead) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
  if (lead.status === "CONVERTED") {
    throw new ApiError("LEAD_CONVERTED", "Converted leads cannot have custom fields updated.", 409);
  }
}

async function assertDealCustomFieldsEditable(workspaceId: string, dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId, ...activeWhere },
    select: { status: true }
  });

  if (!deal) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
  if (deal.status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function duplicateCustomFieldError() {
  return new ApiError("CUSTOM_FIELD_EXISTS", "A custom field with this key already exists for this record type.", 409);
}
