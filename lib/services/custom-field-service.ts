import { CustomFieldType, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import {
  isCustomFieldFilterOperatorAllowed,
  isEmptyCustomFieldValue,
  isSupportedCustomFieldType,
  normalizeCustomFieldFilterOperator,
  normalizeCustomFieldFilterValue
} from "@/lib/custom-field-display";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertRecordInWorkspace } from "./record-guards";

type EditableCustomFieldEntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";
type CreateCustomFieldInput = Omit<Prisma.CustomFieldDefinitionUncheckedCreateInput, "workspaceId" | "options"> & {
  options?: Prisma.InputJsonValue | null;
};
type ListCustomFieldsFilters = {
  entityType?: "DEAL" | "LEAD" | "PERSON" | "ORGANIZATION";
};
export type CustomFieldListFilters = {
  customFieldId?: string;
  customFieldOperator?: string;
  customFieldValue?: string;
};
type UpsertCustomFieldValuesInput = {
  entityType: EditableCustomFieldEntityType;
  entityId: string;
  values: Record<string, unknown>;
};
export type CustomFieldSummaryField = {
  id: string;
  name: string;
  key: string;
  fieldType: CustomFieldType;
  required: boolean;
  value: unknown;
};

export async function listCustomFields(actor: WorkspaceActor, filters: ListCustomFieldsFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const where: Prisma.CustomFieldDefinitionWhereInput = { workspaceId: actor.workspaceId, ...activeWhere };
  if (filters.entityType) where.entityType = filters.entityType;

  return prisma.customFieldDefinition.findMany({
    where,
    orderBy: [{ entityType: "asc" }, { name: "asc" }]
  });
}

export async function createCustomField(actor: WorkspaceActor, data: CreateCustomFieldInput) {
  await ensureWorkspaceAccess(actor);
  if (
    data.entityType !== "DEAL" &&
    data.entityType !== "PERSON" &&
    data.entityType !== "ORGANIZATION" &&
    data.entityType !== "LEAD"
  ) {
    throw new ApiError(
      "UNSUPPORTED_CUSTOM_FIELD_ENTITY",
      "Custom fields currently support deals, contacts, organizations, and leads only.",
      422
    );
  }
  const { options, ...fieldData } = data;
  const field = await prisma.customFieldDefinition.create({
    data: {
      ...fieldData,
      workspaceId: actor.workspaceId,
      options: options === null ? Prisma.JsonNull : options
    }
  });
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
  await assertRecordInWorkspace(recordModel(entityType), actor.workspaceId, entityId);

  return prisma.customFieldDefinition.findMany({
    where: { workspaceId: actor.workspaceId, entityType, ...activeWhere },
    include: {
      values: {
        where: { workspaceId: actor.workspaceId, entityType, entityId },
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
  const fields = await prisma.customFieldDefinition.findMany({
    where: { workspaceId: actor.workspaceId, entityType, ...activeWhere },
    orderBy: { name: "asc" }
  });

  const summaries = new Map<string, CustomFieldSummaryField[]>(
    entityIds.map((entityId) => [entityId, fields.map((field) => ({ ...summaryField(field), value: null }))])
  );

  if (fields.length === 0 || entityIds.length === 0) return summaries;

  const values = await prisma.customFieldValue.findMany({
    where: {
      workspaceId: actor.workspaceId,
      entityType,
      entityId: { in: entityIds },
      fieldId: { in: fields.map((field) => field.id) }
    },
    select: { entityId: true, fieldId: true, value: true }
  });
  const valuesByEntityAndField = new Map(values.map((value) => [`${value.entityId}:${value.fieldId}`, value.value]));

  for (const entityId of entityIds) {
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

export async function listCustomFieldFilteredEntityIds(
  workspaceId: string,
  entityType: EditableCustomFieldEntityType,
  filters: CustomFieldListFilters
) {
  const fieldId = filters.customFieldId?.trim();
  const rawValue = filters.customFieldValue?.trim();
  if (!fieldId) return undefined;

  const operator = normalizeCustomFieldFilterOperator(filters.customFieldOperator);
  if (!operator) return [];
  if ((operator === "equals" || operator === "contains") && !rawValue) return undefined;
  const valueText = rawValue ?? "";

  const field = await prisma.customFieldDefinition.findFirst({
    where: { id: fieldId, workspaceId, entityType, ...activeWhere },
    select: { id: true, fieldType: true }
  });

  if (!field || !isSupportedCustomFieldType(field.fieldType)) return [];
  if (!isCustomFieldFilterOperatorAllowed(field.fieldType, operator)) return [];

  if (operator === "is_empty" || operator === "is_not_empty") {
    const [entityIds, values] = await Promise.all([
      listActiveCustomFieldEntityIds(workspaceId, entityType),
      prisma.customFieldValue.findMany({
        where: { workspaceId, entityType, fieldId },
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
      where: { workspaceId, entityType, fieldId },
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
      entityType,
      fieldId,
      value: { equals: value as Prisma.InputJsonValue }
    },
    select: { entityId: true }
  });

  return matches.map((match) => match.entityId);
}

async function listActiveCustomFieldEntityIds(workspaceId: string, entityType: EditableCustomFieldEntityType) {
  const where = { workspaceId, ...activeWhere };
  if (entityType === "DEAL") {
    const rows = await prisma.deal.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  if (entityType === "PERSON") {
    const rows = await prisma.person.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  if (entityType === "LEAD") {
    const rows = await prisma.lead.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }
  const rows = await prisma.organization.findMany({ where, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function upsertDealCustomFieldValues(
  actor: WorkspaceActor,
  data: Omit<UpsertCustomFieldValuesInput, "entityType">
) {
  return upsertCustomFieldValues(actor, { ...data, entityType: "DEAL" });
}

export async function upsertCustomFieldValues(
  actor: WorkspaceActor,
  data: UpsertCustomFieldValuesInput
) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace(recordModel(data.entityType), actor.workspaceId, data.entityId);
  if (data.entityType === "LEAD") await assertLeadCustomFieldsEditable(actor.workspaceId, data.entityId);

  const fields = await prisma.customFieldDefinition.findMany({
    where: { workspaceId: actor.workspaceId, entityType: data.entityType, ...activeWhere }
  });
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const updates = Object.entries(data.values);

  for (const [fieldId, rawValue] of updates) {
    const field = fieldsById.get(fieldId);
    if (!field) throw new ApiError("NOT_FOUND", "Custom field was not found.", 404);
    const value = normalizeCustomFieldValue(field, rawValue);

    await prisma.customFieldValue.upsert({
      where: { fieldId_entityId: { fieldId, entityId: data.entityId } },
      update: { value },
      create: {
        workspaceId: actor.workspaceId,
        fieldId,
        entityType: data.entityType,
        entityId: data.entityId,
        value
      }
    });
  }

  await writeAuditLog(actor, "custom_field_value.updated", auditEntityType(data.entityType), data.entityId, {
    entityType: data.entityType,
    fieldIds: updates.map(([fieldId]) => fieldId)
  });

  return listRecordCustomFields(actor, data.entityType, data.entityId);
}

function normalizeCustomFieldValue(
  field: { name: string; fieldType: CustomFieldType; required: boolean; options: Prisma.JsonValue },
  rawValue: unknown
) {
  const isBlank = rawValue === null || rawValue === undefined || rawValue === "";
  if (isBlank) {
    if (field.required) throw new ApiError("VALIDATION_ERROR", `${field.name} is required.`, 422);
    return Prisma.JsonNull;
  }

  if (field.fieldType === "TEXT") {
    return String(rawValue);
  }

  if (field.fieldType === "NUMBER") {
    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) throw new ApiError("VALIDATION_ERROR", `${field.name} must be a number.`, 422);
    return value;
  }

  if (field.fieldType === "DATE") {
    const value = String(rawValue);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ApiError("VALIDATION_ERROR", `${field.name} must be a date.`, 422);
    }
    return value;
  }

  if (field.fieldType === "BOOLEAN") {
    if (typeof rawValue === "boolean") return rawValue;
    if (rawValue === "true") return true;
    if (rawValue === "false") return false;
    throw new ApiError("VALIDATION_ERROR", `${field.name} must be true or false.`, 422);
  }

  if (field.fieldType === "SELECT") {
    const value = String(rawValue);
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
