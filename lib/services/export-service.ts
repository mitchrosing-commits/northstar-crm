import { Prisma, type CustomFieldType } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { contactListStateOptions } from "@/lib/contact-list-state";
import { formatCsv, type CsvColumn } from "@/lib/csv";
import { isSupportedCustomFieldType } from "@/lib/custom-field-display";
import { prisma } from "@/lib/db/prisma";
import { dealListStateOptions, dealStatuses } from "@/lib/deal-list-state";
import {
  enumSearchParam,
  listServiceFiltersFromSearchParams,
  optionalSearchParam,
  type ListSearchParams
} from "@/lib/list-page-query";
import { leadListStateOptions, leadStatuses } from "@/lib/lead-list-state";
import { organizationListStateOptions } from "@/lib/organization-list-state";
import { listPeople, type PersonListFilters } from "./contact-service";
import { listActivities, type ActivityListFilters } from "./activity-service";
import { listDeals, type DealListFilters } from "./deal-service";
import { listLeads, type LeadListFilters } from "./lead-service";
import { listOrganizations, type OrganizationListFilters } from "./organization-service";
import { listProducts } from "./product-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export const exportResources = ["deals", "contacts", "organizations", "leads", "activities", "products", "quotes"] as const;
export type ExportResource = (typeof exportResources)[number];
export const exportResourceDetails = {
  deals: {
    title: "Deals",
    description: "Pipeline, stage, value, owner, contact, organization, and deal custom fields."
  },
  contacts: {
    title: "Contacts",
    description: "Names, email, phone, owner, organization, timestamps, and contact custom fields."
  },
  organizations: {
    title: "Organizations",
    description: "Company names, domains, owner, related record counts, timestamps, and organization custom fields."
  },
  leads: {
    title: "Leads",
    description: "Lead status, source, owner, contact, organization, timestamps, and lead custom fields."
  },
  activities: {
    title: "Activities",
    description: "Follow-up title, type, status, due/completed dates, owner, related records, and description."
  },
  products: {
    title: "Products",
    description: "Catalog names, descriptions, unit prices, currencies, active status, and timestamps."
  },
  quotes: {
    title: "Quotes",
    description: "Quote number, status, deal, contact, organization, totals, item count, and timestamps."
  }
} satisfies Record<ExportResource, { title: string; description: string }>;

type ExportResult = {
  filename: string;
  csv: string;
};
export type WorkspaceExportOverviewItem = {
  customFieldCount: number;
  rowCount: number;
};
export type WorkspaceExportOverview = Record<ExportResource, WorkspaceExportOverviewItem>;

type ExportDeal = Prisma.DealGetPayload<{
  include: {
    pipeline: true;
    stage: true;
    person: true;
    organization: true;
    owner: { select: typeof userDisplaySelect };
    quotes: true;
    _count: { select: { lineItems: true; quotes: true } };
  };
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
type ExportProduct = Prisma.ProductGetPayload<object>;
type ExportQuote = Prisma.QuoteGetPayload<{
  include: {
    deal: { include: { person: true; organization: true } };
    items: true;
  };
}>;
type ExportCustomFieldEntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";

export async function exportWorkspaceCsv(
  actor: WorkspaceActor,
  resource: string,
  searchParams: ListSearchParams = {}
): Promise<ExportResult> {
  await ensureWorkspaceAccess(actor);

  if (!isExportResource(resource)) {
    throw new ApiError("NOT_FOUND", "Export was not found.", 404);
  }

  if (resource === "deals") return exportDeals(actor, dealExportFilters(searchParams));
  if (resource === "contacts") return exportContacts(actor, contactExportFilters(searchParams));
  if (resource === "organizations") return exportOrganizations(actor, organizationExportFilters(searchParams));
  if (resource === "leads") return exportLeads(actor, leadExportFilters(searchParams));
  if (resource === "activities") return exportActivities(actor, activityExportFilters(searchParams));
  if (resource === "products") return exportProducts(actor);
  return exportQuotes(actor);
}

export async function getWorkspaceExportOverview(actor: WorkspaceActor): Promise<WorkspaceExportOverview> {
  await ensureWorkspaceAccess(actor);

  const [
    dealCount,
    contactCount,
    organizationCount,
    leadCount,
    activityCount,
    productCount,
    quoteCount,
    dealCustomFieldCount,
    contactCustomFieldCount,
    organizationCustomFieldCount,
    leadCustomFieldCount
  ] = await Promise.all([
    prisma.deal.count({ where: { workspaceId: actor.workspaceId, ...activeWhere } }),
    prisma.person.count({ where: { workspaceId: actor.workspaceId, ...activeWhere } }),
    prisma.organization.count({ where: { workspaceId: actor.workspaceId, ...activeWhere } }),
    prisma.lead.count({ where: { workspaceId: actor.workspaceId, ...activeWhere } }),
    prisma.activity.count({ where: { workspaceId: actor.workspaceId, ...activeWhere } }),
    prisma.product.count({ where: { workspaceId: actor.workspaceId, ...activeWhere } }),
    prisma.quote.count({
      where: {
        workspaceId: actor.workspaceId,
        deal: { workspaceId: actor.workspaceId, ...activeWhere }
      }
    }),
    countExportCustomFields(actor, "DEAL"),
    countExportCustomFields(actor, "PERSON"),
    countExportCustomFields(actor, "ORGANIZATION"),
    countExportCustomFields(actor, "LEAD")
  ]);

  return {
    deals: { rowCount: dealCount, customFieldCount: dealCustomFieldCount },
    contacts: { rowCount: contactCount, customFieldCount: contactCustomFieldCount },
    organizations: { rowCount: organizationCount, customFieldCount: organizationCustomFieldCount },
    leads: { rowCount: leadCount, customFieldCount: leadCustomFieldCount },
    activities: { rowCount: activityCount, customFieldCount: 0 },
    products: { rowCount: productCount, customFieldCount: 0 },
    quotes: { rowCount: quoteCount, customFieldCount: 0 }
  };
}

export function isExportResource(resource: string): resource is ExportResource {
  return (exportResources as readonly string[]).includes(resource);
}

async function exportDeals(actor: WorkspaceActor, filters: DealListFilters): Promise<ExportResult> {
  const deals = await listDeals(actor, filters);
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

async function exportContacts(actor: WorkspaceActor, filters: PersonListFilters): Promise<ExportResult> {
  const contacts = await listPeople(actor, filters);
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

async function exportOrganizations(actor: WorkspaceActor, filters: OrganizationListFilters): Promise<ExportResult> {
  const organizations = await listOrganizations(actor, filters);
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

async function exportLeads(actor: WorkspaceActor, filters: LeadListFilters): Promise<ExportResult> {
  const leads = await listLeads(actor, filters);
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

async function exportActivities(actor: WorkspaceActor, filters: ActivityListFilters): Promise<ExportResult> {
  const activities = await listActivities(actor, filters);

  return {
    filename: "northstar-activities.csv",
    csv: formatCsv(activityColumns, activities)
  };
}

async function exportProducts(actor: WorkspaceActor): Promise<ExportResult> {
  const products = await listProducts(actor);

  return {
    filename: "northstar-products.csv",
    csv: formatCsv(productColumns, products)
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
      items: { where: { workspaceId: actor.workspaceId } }
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
  { header: "contactName", value: (deal) => workspacePersonName(deal.workspaceId, deal.person) },
  { header: "contactEmail", value: (deal) => workspacePersonEmail(deal.workspaceId, deal.person) },
  { header: "organizationName", value: (deal) => workspaceOrganizationName(deal.workspaceId, deal.organization) },
  { header: "ownerEmail", value: (deal) => deal.owner?.email },
  { header: "lineItemCount", value: (deal) => deal._count.lineItems },
  { header: "quoteCount", value: (deal) => deal._count.quotes },
  { header: "latestQuoteNumber", value: (deal) => deal.quotes[0]?.number },
  { header: "latestQuoteStatus", value: (deal) => deal.quotes[0]?.status },
  { header: "latestQuoteTotal", value: (deal) => centsToDecimal(deal.quotes[0]?.totalCents ?? null) },
  { header: "createdAt", value: (deal) => deal.createdAt },
  { header: "updatedAt", value: (deal) => deal.updatedAt }
] satisfies Array<CsvColumn<ExportDeal>>;

const contactColumns = [
  { header: "firstName", value: (person) => person.firstName },
  { header: "lastName", value: (person) => person.lastName },
  { header: "email", value: (person) => person.email },
  { header: "phone", value: (person) => person.phone },
  { header: "organizationName", value: (person) => workspaceOrganizationName(person.workspaceId, person.organization) },
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
  { header: "contactName", value: (lead) => workspacePersonName(lead.workspaceId, lead.person) },
  { header: "contactEmail", value: (lead) => workspacePersonEmail(lead.workspaceId, lead.person) },
  { header: "organizationName", value: (lead) => workspaceOrganizationName(lead.workspaceId, lead.organization) },
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
  { header: "dealTitle", value: (activity) => workspaceDealTitle(activity.workspaceId, activity.deal) },
  { header: "leadTitle", value: (activity) => workspaceLeadTitle(activity.workspaceId, activity.lead) },
  { header: "contactName", value: (activity) => workspacePersonName(activity.workspaceId, activity.person) },
  { header: "contactEmail", value: (activity) => workspacePersonEmail(activity.workspaceId, activity.person) },
  { header: "organizationName", value: (activity) => workspaceOrganizationName(activity.workspaceId, activity.organization) },
  { header: "ownerEmail", value: (activity) => activity.owner?.email },
  { header: "description", value: (activity) => activity.description },
  { header: "createdAt", value: (activity) => activity.createdAt },
  { header: "updatedAt", value: (activity) => activity.updatedAt }
] satisfies Array<CsvColumn<ExportActivity>>;

const productColumns = [
  { header: "name", value: (product) => product.name },
  { header: "description", value: (product) => product.description },
  { header: "unitPrice", value: (product) => centsToDecimal(product.unitPriceCents) },
  { header: "currency", value: (product) => product.currency },
  { header: "active", value: (product) => (product.active ? "Yes" : "No") },
  { header: "createdAt", value: (product) => product.createdAt },
  { header: "updatedAt", value: (product) => product.updatedAt }
] satisfies Array<CsvColumn<ExportProduct>>;

const quoteColumns = [
  { header: "number", value: (quote) => quote.number },
  { header: "status", value: (quote) => quote.status },
  { header: "dealTitle", value: (quote) => quote.deal.title },
  { header: "contactName", value: (quote) => workspacePersonName(quote.workspaceId, quote.deal.person) },
  { header: "contactEmail", value: (quote) => workspacePersonEmail(quote.workspaceId, quote.deal.person) },
  { header: "organizationName", value: (quote) => workspaceOrganizationName(quote.workspaceId, quote.deal.organization) },
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

function workspacePersonName(
  workspaceId: string,
  person: { workspaceId: string; firstName: string; lastName: string | null; deletedAt?: Date | string | null } | null
) {
  return person?.workspaceId === workspaceId && !person.deletedAt ? personName(person) : "";
}

function workspacePersonEmail(
  workspaceId: string,
  person: { workspaceId: string; email: string | null; deletedAt?: Date | string | null } | null
) {
  return person?.workspaceId === workspaceId && !person.deletedAt ? person.email : "";
}

function workspaceOrganizationName(
  workspaceId: string,
  organization: { workspaceId: string; name: string; deletedAt?: Date | string | null } | null
) {
  return organization?.workspaceId === workspaceId && !organization.deletedAt ? organization.name : "";
}

function workspaceDealTitle(
  workspaceId: string,
  deal: { workspaceId: string; title: string; deletedAt?: Date | string | null } | null
) {
  return deal?.workspaceId === workspaceId && !deal.deletedAt ? deal.title : "";
}

function workspaceLeadTitle(
  workspaceId: string,
  lead: { workspaceId: string; title: string; deletedAt?: Date | string | null } | null
) {
  return lead?.workspaceId === workspaceId && !lead.deletedAt ? lead.title : "";
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

  const duplicateNames = new Set(
    Array.from(
      fields
        .reduce((counts, field) => {
          const nameKey = normalizeCustomFieldExportName(field.name);
          counts.set(nameKey, (counts.get(nameKey) ?? 0) + 1);
          return counts;
        }, new Map<string, number>())
        .entries()
    )
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
  );

  return fields.map((field) => ({
    header: customFieldExportHeader(field, duplicateNames),
    value: (record) => formatCustomFieldExportValue(valuesByEntityAndField.get(`${record.id}:${field.id}`), field.fieldType)
  }));
}

function countExportCustomFields(actor: WorkspaceActor, entityType: ExportCustomFieldEntityType) {
  return prisma.customFieldDefinition.count({
    where: { workspaceId: actor.workspaceId, entityType, ...activeWhere }
  });
}

function customFieldExportHeader(
  field: { name: string; key: string },
  duplicateNames: ReadonlySet<string>
) {
  return duplicateNames.has(normalizeCustomFieldExportName(field.name))
    ? `Custom: ${field.name} (${field.key})`
    : `Custom: ${field.name}`;
}

function normalizeCustomFieldExportName(name: string) {
  return name.trim().toLowerCase();
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

function dealExportFilters(searchParams: ListSearchParams): DealListFilters {
  return listServiceFiltersFromSearchParams(searchParams, dealListStateOptions, {
    status: dealStatuses,
    commercial: ["noQuote", "hasQuote", "acceptedQuote", "valueNoLineItems"]
  }) as DealListFilters;
}

function contactExportFilters(searchParams: ListSearchParams): PersonListFilters {
  return listServiceFiltersFromSearchParams(searchParams, contactListStateOptions) as PersonListFilters;
}

function organizationExportFilters(searchParams: ListSearchParams): OrganizationListFilters {
  return listServiceFiltersFromSearchParams(searchParams, organizationListStateOptions) as OrganizationListFilters;
}

function leadExportFilters(searchParams: ListSearchParams): LeadListFilters {
  return listServiceFiltersFromSearchParams(searchParams, leadListStateOptions, {
    status: leadStatuses
  }) as LeadListFilters;
}

const activityStatuses = ["open", "completed"] as const;
const activityCompletedFilters = ["recent"] as const;
const activityDueBuckets = ["overdue", "today", "upcoming", "unscheduled"] as const;
const activityRelatedTypes = ["deal", "lead", "person", "organization"] as const;
const activitySorts = ["dueAt", "createdAt", "updatedAt", "title", "completedAt"] as const;

function activityExportFilters(searchParams: ListSearchParams): ActivityListFilters {
  const related = parseActivityRelatedFilter(optionalSearchParam(searchParams, "related") ?? "");

  return {
    q: optionalSearchParam(searchParams, "q"),
    status: enumSearchParam(searchParams, "status", activityStatuses),
    ownerId: optionalSearchParam(searchParams, "ownerId"),
    relatedType: related?.type,
    relatedId: related?.id,
    due: enumSearchParam(searchParams, "due", activityDueBuckets),
    completed: enumSearchParam(searchParams, "completed", activityCompletedFilters),
    sortBy: enumSearchParam(searchParams, "sortBy", activitySorts),
    sortDirection: enumSearchParam(searchParams, "sortDirection", ["asc", "desc"] as const)
  };
}

function parseActivityRelatedFilter(value: string) {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return undefined;
  const [type, rawId] = parts;
  const id = rawId.trim();
  if (!id || !activityRelatedTypes.includes(type as (typeof activityRelatedTypes)[number])) return undefined;
  return { type: type as (typeof activityRelatedTypes)[number], id };
}
