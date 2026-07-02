import { CustomFieldEntityType, Prisma, SavedViewRecordType, type CustomFieldType } from "@prisma/client";

import {
  supplyChainDealFieldTemplates,
  supplyChainDeferredBoundaries,
  supplyChainLeadFieldTemplates,
  supplyChainOrganizationFieldTemplates,
  supplyChainSavedViewRecommendations,
  supplyChainServiceCatalogExamples,
  type VerticalCustomFieldTemplate,
  type VerticalEntityType
} from "@/lib/supply-chain-implementation-config";
import { prisma } from "@/lib/db/prisma";
import { createCustomField } from "./custom-field-service";
import { createProduct } from "./product-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

type SetupBucket = {
  total: number;
  existing: number;
  missing: number;
  created: number;
  skipped: number;
  deferred: number;
};

export type SupplyChainVerticalSetupStatus = {
  customFields: SetupBucket;
  savedViews: SetupBucket;
  products: SetupBucket;
  unsupported: string[];
};

type SupportedSavedViewPreset = {
  recordType: "DEAL" | "LEAD" | "ORGANIZATION";
  name: string;
  fieldKey: string;
  operator: "equals" | "is_empty" | "is_not_empty";
  value?: string;
};

const supplyChainCustomFieldTemplates = [
  ...supplyChainDealFieldTemplates,
  ...supplyChainOrganizationFieldTemplates,
  ...supplyChainLeadFieldTemplates
];

const supportedSavedViewPresets: SupportedSavedViewPreset[] = [
  { recordType: "DEAL", name: "Deals Missing Go-Live Date", fieldKey: "go_live_target_date", operator: "is_empty" },
  { recordType: "LEAD", name: "Leads Needing Software Selection", fieldKey: "needs_software_selection", operator: "equals", value: "true" },
  { recordType: "LEAD", name: "Leads Needing Implementation Partner", fieldKey: "needs_implementation_partner", operator: "equals", value: "true" },
  { recordType: "LEAD", name: "Leads Needing Support", fieldKey: "needs_support", operator: "equals", value: "true" },
  { recordType: "LEAD", name: "Leads Missing Decision Maker", fieldKey: "decision_maker_known", operator: "equals", value: "false" },
  { recordType: "ORGANIZATION", name: "Accounts by Current Platform", fieldKey: "current_wms", operator: "is_not_empty" },
  { recordType: "ORGANIZATION", name: "Existing Customers", fieldKey: "existing_customer", operator: "equals", value: "true" }
];

export async function getSupplyChainVerticalSetupStatus(actor: WorkspaceActor): Promise<SupplyChainVerticalSetupStatus> {
  await ensureWorkspaceAccess(actor);

  const [fields, savedViews, products] = await Promise.all([
    prisma.customFieldDefinition.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { entityType: true, key: true }
    }),
    prisma.savedView.findMany({
      where: { workspaceId: actor.workspaceId },
      select: { recordType: true, name: true }
    }),
    prisma.product.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { name: true }
    })
  ]);

  const fieldKeys = new Set(fields.map((field) => fieldIdentity(field.entityType, field.key)));
  const savedViewKeys = new Set(savedViews.map((view) => savedViewIdentity(view.recordType, view.name)));
  const productNames = new Set(products.map((product) => normalizePresetName(product.name)));

  return {
    customFields: bucketFromTotals(
      supplyChainCustomFieldTemplates.length,
      supplyChainCustomFieldTemplates.filter((field) => fieldKeys.has(fieldIdentity(field.entityType, field.key))).length
    ),
    savedViews: {
      ...bucketFromTotals(
        supportedSavedViewPresets.length,
        supportedSavedViewPresets.filter((view) => savedViewKeys.has(savedViewIdentity(view.recordType, view.name))).length
      ),
      deferred: deferredSavedViewRecommendations().length
    },
    products: bucketFromTotals(
      supplyChainServiceCatalogExamples.length,
      supplyChainServiceCatalogExamples.filter((name) => productNames.has(normalizePresetName(name))).length
    ),
    unsupported: unsupportedVerticalSetupItems()
  };
}

export async function applySupplyChainVerticalPresets(actor: WorkspaceActor): Promise<SupplyChainVerticalSetupStatus> {
  await ensureWorkspaceAccess(actor);

  const customFields = await applySupplyChainCustomFieldPresets(actor);
  const [savedViews, products] = await Promise.all([
    applySupplyChainSavedViewPresets(actor),
    applySupplyChainProductCatalogPresets(actor)
  ]);

  return {
    customFields,
    savedViews,
    products,
    unsupported: unsupportedVerticalSetupItems()
  };
}

export async function applySupplyChainCustomFieldPresets(actor: WorkspaceActor): Promise<SetupBucket> {
  await ensureWorkspaceAccess(actor);

  const existing = await prisma.customFieldDefinition.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { entityType: true, key: true, deletedAt: true }
  });
  const existingActive = new Set(existing.filter((field) => !field.deletedAt).map((field) => fieldIdentity(field.entityType, field.key)));
  const reservedDeleted = new Set(existing.filter((field) => field.deletedAt).map((field) => fieldIdentity(field.entityType, field.key)));
  const presetIdentities = supplyChainCustomFieldTemplates.map((template) => fieldIdentity(template.entityType, template.key));
  const existingPresetCount = presetIdentities.filter((identity) => existingActive.has(identity)).length;
  let created = 0;
  let skipped = 0;

  for (const template of supplyChainCustomFieldTemplates) {
    const identity = fieldIdentity(template.entityType, template.key);
    if (existingActive.has(identity)) continue;
    if (reservedDeleted.has(identity)) {
      skipped += 1;
      continue;
    }

    await createCustomField(actor, {
      entityType: template.entityType,
      name: template.name,
      key: template.key,
      fieldType: template.fieldType as CustomFieldType,
      required: false,
      options: template.options ?? null
    });
    existingActive.add(identity);
    created += 1;
  }

  return {
    total: supplyChainCustomFieldTemplates.length,
    existing: existingPresetCount,
    missing: Math.max(0, supplyChainCustomFieldTemplates.length - existingPresetCount - created - skipped),
    created,
    skipped,
    deferred: 0
  };
}

export async function applySupplyChainSavedViewPresets(actor: WorkspaceActor): Promise<SetupBucket> {
  await ensureWorkspaceAccess(actor);

  const [fields, savedViews] = await Promise.all([
    prisma.customFieldDefinition.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, entityType: true, key: true }
    }),
    prisma.savedView.findMany({
      where: { workspaceId: actor.workspaceId },
      select: { recordType: true, name: true }
    })
  ]);
  const fieldsByIdentity = new Map(fields.map((field) => [fieldIdentity(field.entityType, field.key), field]));
  const existingViews = new Set(savedViews.map((view) => savedViewIdentity(view.recordType, view.name)));
  const existingPresetCount = supportedSavedViewPresets.filter((preset) =>
    existingViews.has(savedViewIdentity(preset.recordType, preset.name))
  ).length;
  let created = 0;
  let skipped = 0;

  for (const preset of supportedSavedViewPresets) {
    const identity = savedViewIdentity(preset.recordType, preset.name);
    if (existingViews.has(identity)) continue;

    const field = fieldsByIdentity.get(fieldIdentity(preset.recordType, preset.fieldKey));
    if (!field) {
      skipped += 1;
      continue;
    }

    await prisma.savedView.create({
      data: {
        workspaceId: actor.workspaceId,
        recordType: preset.recordType,
        name: preset.name,
        state: JSON.parse(JSON.stringify(savedViewStateForPreset(preset, field.id))) as Prisma.InputJsonValue
      }
    });
    existingViews.add(identity);
    created += 1;
  }

  return {
    total: supportedSavedViewPresets.length,
    existing: existingPresetCount,
    missing: Math.max(0, supportedSavedViewPresets.length - existingPresetCount - created - skipped),
    created,
    skipped,
    deferred: deferredSavedViewRecommendations().length
  };
}

export async function applySupplyChainProductCatalogPresets(actor: WorkspaceActor): Promise<SetupBucket> {
  await ensureWorkspaceAccess(actor);

  const existing = await prisma.product.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    select: { name: true }
  });
  const existingNames = new Set(existing.map((product) => normalizePresetName(product.name)));
  const existingPresetCount = supplyChainServiceCatalogExamples.filter((name) => existingNames.has(normalizePresetName(name))).length;
  let created = 0;

  for (const name of supplyChainServiceCatalogExamples) {
    const normalizedName = normalizePresetName(name);
    if (existingNames.has(normalizedName)) continue;

    await createProduct(actor, {
      name,
      description: "Editable supply-chain implementation consulting service template.",
      unitPriceCents: 0,
      currency: "USD"
    });
    existingNames.add(normalizedName);
    created += 1;
  }

  return {
    total: supplyChainServiceCatalogExamples.length,
    existing: existingPresetCount,
    missing: Math.max(0, supplyChainServiceCatalogExamples.length - existingPresetCount - created),
    created,
    skipped: 0,
    deferred: 0
  };
}

function savedViewStateForPreset(preset: SupportedSavedViewPreset, fieldId: string) {
  const baseState = {
    filters: {
      customFieldId: fieldId,
      customFieldOperator: preset.operator,
      ...(preset.value ? { customFieldValue: preset.value } : {})
    },
    pageSize: 10,
    sortBy: preset.recordType === "ORGANIZATION" ? "name" : "updatedAt",
    sortDirection: preset.recordType === "ORGANIZATION" ? "asc" : "desc"
  };
  return baseState;
}

function bucketFromTotals(total: number, existing: number): SetupBucket {
  return {
    total,
    existing,
    missing: Math.max(0, total - existing),
    created: 0,
    skipped: 0,
    deferred: 0
  };
}

function deferredSavedViewRecommendations() {
  const supportedNames = new Set(supportedSavedViewPresets.map((preset) => preset.name));
  return supplyChainSavedViewRecommendations.filter((recommendation) => !supportedNames.has(recommendation.name));
}

function unsupportedVerticalSetupItems() {
  return [
    "Saved-view presets are workspace-scoped because the current SavedView model has no user ownership column.",
    "Activity saved-view presets are deferred because SavedViewRecordType does not include ACTIVITY.",
    "Select-field analytics and select-field saved-view filters are deferred until custom-field filtering supports SELECT values.",
    "Custom-field CSV import is deferred until explicit mapping and validation exist.",
    ...supplyChainDeferredBoundaries
  ];
}

function fieldIdentity(entityType: CustomFieldEntityType | VerticalEntityType | SavedViewRecordType, key: string) {
  return `${entityType}:${key}`;
}

function savedViewIdentity(recordType: SavedViewRecordType | SupportedSavedViewPreset["recordType"], name: string) {
  return `${recordType}:${normalizePresetName(name)}`;
}

function normalizePresetName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
