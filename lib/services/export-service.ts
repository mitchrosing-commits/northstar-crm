import { Prisma, type CustomFieldType } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { formatCsv, type CsvColumn } from "@/lib/csv";
import { isSupportedCustomFieldType } from "@/lib/custom-field-display";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export const exportResources = ["deals", "contacts", "organizations", "leads", "activities", "quotes"] as const;
export type ExportResource = (typeof exportResources)[number];

type ExportResult = {
  filename: string;
  csv: string;
};

type ExportDeal = Prisma.DealGetPayload<{
  include: { pipeline: true; stage: true; person: true; organization: true; owner: { select: typeof userDisplaySelect } };
}>;
type ExportContact = Prisma.PersonGetPayload<{ include: { organization: true; owner: { select: typeof userDisplaySelect } } }>;
type ExportOrganization = Prisma.OrganizationGetPayload<{
  include: { owner: { select: typeof userDisplaySelect }; _count: { select: { people: true; deals: true } } };
}>;
type ExportLead = Prisma.LeadGetPayload<{ include: { person: true; organization: true; owner: { select: typeof userDisplaySelect } } }>;
type ExportActivity = Prisma.ActivityGetPayload<{
  include: {
    owner: { select: typeof userDisplaySelect };
    deal: true;
    lead: true;
    person: true;
    organization: true;
  };
}>;
type ExportQuote = Prisma.QuoteGetPayload<{
  include: {
    deal: { include: { person: true; organization: true } };
    items: true;
  };
}>;
type ExportCustomFieldEntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";

export async function exportWorkspaceCsv(actor: WorkspaceActor, resource: string): Promise<ExportResult> {
  await ensureWorkspaceAccess(actor);

  if (!isExportResource(resource)) {
    throw new ApiError("NOT_FOUND", "Export was not found.", 404);
  }

  if (resource === "deals") return exportDeals(actor);
  if (resource === "contacts") return exportContacts(actor);
  if (resource === "organizations") return exportOrganizations(actor);
  if (resource === "leads") return exportLeads(actor);
  if (resource === "activities") return exportActivities(actor);
  return exportQuotes(actor);
}

export function isExportResource(resource: string): resource is ExportResource {
  return (exportResources as readonly string[]).includes(resource);
}

async function exportDeals(actor: WorkspaceActor): Promise<ExportResult> {
  const deals = await prisma.deal.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: {
      pipeline: true,
      stage: true,
      person: true,
      organization: true,
      owner: { select: userDisplaySelect }
    },
    orderBy: [{ createdAt: "asc" }, { title: "asc" }]
  });
  const customFieldColumns = await listCustomFieldExportColumns<ExportDeal>(
    actor,
    "DEAL",
    deals.map((deal) => deal.id)
  );

  return {
    filename: "northstar-deals.csv",
    csv: formatCsv([...dealColumns, ...customFieldColumns], deals)
  };
}

async function exportContacts(actor: WorkspaceActor): Promise<ExportResult> {
  const contacts = await prisma.person.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: { organization: true, owner: { select: userDisplaySelect } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { createdAt: "asc" }]
  });
  const customFieldColumns = await listCustomFieldExportColumns<ExportContact>(
    actor,
    "PERSON",
    contacts.map((contact) => contact.id)
  );

  return {
    filename: "northstar-contacts.csv",
    csv: formatCsv([...contactColumns, ...customFieldColumns], contacts)
  };
}

async function exportOrganizations(actor: WorkspaceActor): Promise<ExportResult> {
  const organizations = await prisma.organization.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: { owner: { select: userDisplaySelect }, _count: { select: { people: true, deals: true } } },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }]
  });
  const customFieldColumns = await listCustomFieldExportColumns<ExportOrganization>(
    actor,
    "ORGANIZATION",
    organizations.map((organization) => organization.id)
  );

  return {
    filename: "northstar-organizations.csv",
    csv: formatCsv([...organizationColumns, ...customFieldColumns], organizations)
  };
}

async function exportLeads(actor: WorkspaceActor): Promise<ExportResult> {
  const leads = await prisma.lead.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: { person: true, organization: true, owner: { select: userDisplaySelect } },
    orderBy: [{ createdAt: "asc" }, { title: "asc" }]
  });
  const customFieldColumns = await listCustomFieldExportColumns<ExportLead>(
    actor,
    "LEAD",
    leads.map((lead) => lead.id)
  );

  return {
    filename: "northstar-leads.csv",
    csv: formatCsv([...leadColumns, ...customFieldColumns], leads)
  };
}

async function exportActivities(actor: WorkspaceActor): Promise<ExportResult> {
  const activities = await prisma.activity.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: {
      owner: { select: userDisplaySelect },
      deal: true,
      lead: true,
      person: true,
      organization: true
    },
    orderBy: [{ createdAt: "asc" }, { title: "asc" }]
  });

  return {
    filename: "northstar-activities.csv",
    csv: formatCsv(activityColumns, activities)
  };
}

async function exportQuotes(actor: WorkspaceActor): Promise<ExportResult> {
  const quotes = await prisma.quote.findMany({
    where: {
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: {
      deal: { include: { person: true, organization: true } },
      items: true
    },
    orderBy: [{ createdAt: "asc" }, { number: "asc" }]
  });

  return {
    filename: "northstar-quotes.csv",
    csv: formatCsv(quoteColumns, quotes)
  };
}

const dealColumns = [
  { header: "title", value: (deal) => deal.title },
  { header: "status", value: (deal) => deal.status },
  { header: "value", value: (deal) => centsToDecimal(deal.valueCents) },
  { header: "currency", value: (deal) => deal.currency },
  { header: "pipeline", value: (deal) => deal.pipeline.name },
  { header: "stage", value: (deal) => deal.stage.name },
  { header: "expectedCloseAt", value: (deal) => deal.expectedCloseAt },
  { header: "contactName", value: (deal) => personName(deal.person) },
  { header: "contactEmail", value: (deal) => deal.person?.email },
  { header: "organizationName", value: (deal) => deal.organization?.name },
  { header: "ownerEmail", value: (deal) => deal.owner?.email },
  { header: "createdAt", value: (deal) => deal.createdAt },
  { header: "updatedAt", value: (deal) => deal.updatedAt }
] satisfies Array<CsvColumn<ExportDeal>>;

const contactColumns = [
  { header: "firstName", value: (person) => person.firstName },
  { header: "lastName", value: (person) => person.lastName },
  { header: "email", value: (person) => person.email },
  { header: "phone", value: (person) => person.phone },
  { header: "organizationName", value: (person) => person.organization?.name },
  { header: "ownerEmail", value: (person) => person.owner?.email },
  { header: "createdAt", value: (person) => person.createdAt },
  { header: "updatedAt", value: (person) => person.updatedAt }
] satisfies Array<CsvColumn<ExportContact>>;

const organizationColumns = [
  { header: "name", value: (organization) => organization.name },
  { header: "domain", value: (organization) => organization.domain },
  { header: "ownerEmail", value: (organization) => organization.owner?.email },
  { header: "peopleCount", value: (organization) => organization._count.people },
  { header: "dealsCount", value: (organization) => organization._count.deals },
  { header: "createdAt", value: (organization) => organization.createdAt },
  { header: "updatedAt", value: (organization) => organization.updatedAt }
] satisfies Array<CsvColumn<ExportOrganization>>;

const leadColumns = [
  { header: "title", value: (lead) => lead.title },
  { header: "status", value: (lead) => lead.status },
  { header: "source", value: (lead) => lead.source },
  { header: "contactName", value: (lead) => personName(lead.person) },
  { header: "contactEmail", value: (lead) => lead.person?.email },
  { header: "organizationName", value: (lead) => lead.organization?.name },
  { header: "ownerEmail", value: (lead) => lead.owner?.email },
  { header: "createdAt", value: (lead) => lead.createdAt },
  { header: "updatedAt", value: (lead) => lead.updatedAt }
] satisfies Array<CsvColumn<ExportLead>>;

const activityColumns = [
  { header: "title", value: (activity) => activity.title },
  { header: "type", value: (activity) => activity.type },
  { header: "status", value: (activity) => (activity.completedAt ? "COMPLETED" : "OPEN") },
  { header: "dueAt", value: (activity) => activity.dueAt },
  { header: "completedAt", value: (activity) => activity.completedAt },
  { header: "dealTitle", value: (activity) => activity.deal?.title },
  { header: "leadTitle", value: (activity) => activity.lead?.title },
  { header: "contactName", value: (activity) => personName(activity.person) },
  { header: "contactEmail", value: (activity) => activity.person?.email },
  { header: "organizationName", value: (activity) => activity.organization?.name },
  { header: "ownerEmail", value: (activity) => activity.owner?.email },
  { header: "description", value: (activity) => activity.description },
  { header: "createdAt", value: (activity) => activity.createdAt },
  { header: "updatedAt", value: (activity) => activity.updatedAt }
] satisfies Array<CsvColumn<ExportActivity>>;

const quoteColumns = [
  { header: "number", value: (quote) => quote.number },
  { header: "status", value: (quote) => quote.status },
  { header: "dealTitle", value: (quote) => quote.deal.title },
  { header: "contactName", value: (quote) => personName(quote.deal.person) },
  { header: "contactEmail", value: (quote) => quote.deal.person?.email },
  { header: "organizationName", value: (quote) => quote.deal.organization?.name },
  { header: "currency", value: (quote) => quote.currency },
  { header: "subtotal", value: (quote) => centsToDecimal(quote.subtotalCents) },
  { header: "discountType", value: (quote) => quote.discountType },
  { header: "discount", value: (quote) => centsToDecimal(quote.discountCents) },
  { header: "taxType", value: (quote) => quote.taxType },
  { header: "tax", value: (quote) => centsToDecimal(quote.taxCents) },
  { header: "total", value: (quote) => centsToDecimal(quote.totalCents) },
  { header: "itemCount", value: (quote) => quote.items.length },
  { header: "createdAt", value: (quote) => quote.createdAt },
  { header: "updatedAt", value: (quote) => quote.updatedAt }
] satisfies Array<CsvColumn<ExportQuote>>;

function centsToDecimal(valueCents: number | null) {
  if (valueCents === null) return "";
  return (valueCents / 100).toFixed(2);
}

function personName(person: { firstName: string; lastName: string | null } | null) {
  if (!person) return "";
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

async function listCustomFieldExportColumns<T extends { id: string }>(
  actor: WorkspaceActor,
  entityType: ExportCustomFieldEntityType,
  entityIds: string[]
): Promise<Array<CsvColumn<T>>> {
  const fields = await prisma.customFieldDefinition.findMany({
    where: { workspaceId: actor.workspaceId, entityType, ...activeWhere },
    select: { id: true, name: true, key: true, fieldType: true },
    orderBy: [{ name: "asc" }, { key: "asc" }, { id: "asc" }]
  });

  if (fields.length === 0) return [];

  const values =
    entityIds.length === 0
      ? []
      : await prisma.customFieldValue.findMany({
          where: {
            workspaceId: actor.workspaceId,
            entityType,
            entityId: { in: entityIds },
            fieldId: { in: fields.map((field) => field.id) }
          },
          select: { entityId: true, fieldId: true, value: true }
        });
  const valuesByEntityAndField = new Map(values.map((value) => [`${value.entityId}:${value.fieldId}`, value.value]));

  return fields.map((field) => ({
    header: `Custom: ${field.name}`,
    value: (record) => formatCustomFieldExportValue(valuesByEntityAndField.get(`${record.id}:${field.id}`), field.fieldType)
  }));
}

function formatCustomFieldExportValue(value: unknown, fieldType: CustomFieldType) {
  if (value === null || value === undefined || value === "") return "";

  if (isSupportedCustomFieldType(fieldType)) {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
    return value.map((item) => (typeof item === "boolean" ? (item ? "Yes" : "No") : String(item))).join("; ");
  }

  return "";
}
