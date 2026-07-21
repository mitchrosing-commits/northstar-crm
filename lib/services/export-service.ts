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
  { header: "Deal Title", value: (deal) => deal.title },
  { header: "Status", value: (deal) => formatExportStatus(deal.status) },
  { header: "Deal Value", value: (deal) => centsToDecimal(deal.valueCents) },
  { header: "Currency", value: (deal) => deal.currency },
  { header: "Pipeline", value: (deal) => deal.pipeline.name },
  { header: "Stage", value: (deal) => deal.stage.name },
  { header: "Expected Close", value: (deal) => formatExportDate(deal.expectedCloseAt) },
  { header: "Contact Name", value: (deal) => workspacePersonName(deal.workspaceId, deal.person) },
  { header: "Contact Email", value: (deal) => workspacePersonEmail(deal.workspaceId, deal.person) },
  { header: "Organization Name", value: (deal) => workspaceOrganizationName(deal.workspaceId, deal.organization) },
  { header: "Owner Email", value: (deal) => deal.owner?.email },
  { header: "Line Item Count", value: (deal) => deal._count.lineItems },
  { header: "Quote Count", value: (deal) => deal._count.quotes },
  { header: "Latest Quote Number", value: (deal) => deal.quotes[0]?.number },
  { header: "Latest Quote Status", value: (deal) => formatExportStatus(deal.quotes[0]?.status) },
  { header: "Latest Quote Total", value: (deal) => centsToDecimal(deal.quotes[0]?.totalCents ?? null) },
  { header: "Created At", value: (deal) => formatExportDateTime(deal.createdAt) },
  { header: "Updated At", value: (deal) => formatExportDateTime(deal.updatedAt) }
] satisfies Array<CsvColumn<ExportDeal>>;

const contactColumns = [
  { header: "First Name", value: (person) => person.firstName },
  { header: "Last Name", value: (person) => person.lastName },
  { header: "Email", value: (person) => person.email },
  { header: "Phone", value: (person) => person.phone },
  { header: "Organization Name", value: (person) => workspaceOrganizationName(person.workspaceId, person.organization) },
  { header: "Owner Email", value: (person) => person.owner?.email },
  { header: "Created At", value: (person) => formatExportDateTime(person.createdAt) },
  { header: "Updated At", value: (person) => formatExportDateTime(person.updatedAt) }
] satisfies Array<CsvColumn<ExportContact>>;

const organizationColumns = [
  { header: "Organization Name", value: (organization) => organization.name },
  { header: "Domain", value: (organization) => organization.domain },
  { header: "Owner Email", value: (organization) => organization.owner?.email },
  { header: "People Count", value: (organization) => organization._count.people },
  { header: "Deal Count", value: (organization) => organization._count.deals },
  { header: "Created At", value: (organization) => formatExportDateTime(organization.createdAt) },
  { header: "Updated At", value: (organization) => formatExportDateTime(organization.updatedAt) }
] satisfies Array<CsvColumn<ExportOrganization>>;

const leadColumns = [
  { header: "Lead Title", value: (lead) => lead.title },
  { header: "Status", value: (lead) => formatExportStatus(lead.status) },
  { header: "Source", value: (lead) => lead.source },
  { header: "Contact Name", value: (lead) => workspacePersonName(lead.workspaceId, lead.person) },
  { header: "Contact Email", value: (lead) => workspacePersonEmail(lead.workspaceId, lead.person) },
  { header: "Organization Name", value: (lead) => workspaceOrganizationName(lead.workspaceId, lead.organization) },
  { header: "Owner Email", value: (lead) => lead.owner?.email },
  { header: "Created At", value: (lead) => formatExportDateTime(lead.createdAt) },
  { header: "Updated At", value: (lead) => formatExportDateTime(lead.updatedAt) }
] satisfies Array<CsvColumn<ExportLead>>;

const activityColumns = [
  { header: "Activity Title", value: (activity) => activity.title },
  { header: "Type", value: (activity) => formatExportStatus(activity.type) },
  { header: "Status", value: (activity) => (activity.completedAt ? "Completed" : "Open") },
  { header: "Due At", value: (activity) => formatExportDateTime(activity.dueAt) },
  { header: "Completed At", value: (activity) => formatExportDateTime(activity.completedAt) },
  { header: "Deal Title", value: (activity) => workspaceDealTitle(activity.workspaceId, activity.deal) },
  { header: "Lead Title", value: (activity) => workspaceLeadTitle(activity.workspaceId, activity.lead) },
  { header: "Contact Name", value: (activity) => workspacePersonName(activity.workspaceId, activity.person) },
  { header: "Contact Email", value: (activity) => workspacePersonEmail(activity.workspaceId, activity.person) },
  { header: "Organization Name", value: (activity) => workspaceOrganizationName(activity.workspaceId, activity.organization) },
  { header: "Owner Email", value: (activity) => activity.owner?.email },
  { header: "Description", value: (activity) => activity.description },
  { header: "Created At", value: (activity) => formatExportDateTime(activity.createdAt) },
  { header: "Updated At", value: (activity) => formatExportDateTime(activity.updatedAt) }
] satisfies Array<CsvColumn<ExportActivity>>;

const productColumns = [
  { header: "Product Name", value: (product) => product.name },
  { header: "Description", value: (product) => product.description },
  { header: "Unit Price", value: (product) => centsToDecimal(product.unitPriceCents) },
  { header: "Currency", value: (product) => product.currency },
  { header: "Active", value: (product) => (product.active ? "Yes" : "No") },
  { header: "Created At", value: (product) => formatExportDateTime(product.createdAt) },
  { header: "Updated At", value: (product) => formatExportDateTime(product.updatedAt) }
] satisfies Array<CsvColumn<ExportProduct>>;

const quoteColumns = [
  { header: "Quote Number", value: (quote) => quote.number },
  { header: "Status", value: (quote) => formatExportStatus(quote.status) },
  { header: "Deal Title", value: (quote) => quote.deal.title },
  { header: "Contact Name", value: (quote) => workspacePersonName(quote.workspaceId, quote.deal.person) },
  { header: "Contact Email", value: (quote) => workspacePersonEmail(quote.workspaceId, quote.deal.person) },
  { header: "Organization Name", value: (quote) => workspaceOrganizationName(quote.workspaceId, quote.deal.organization) },
  { header: "Currency", value: (quote) => quote.currency },
  { header: "Subtotal", value: (quote) => centsToDecimal(quote.subtotalCents) },
  { header: "Discount Type", value: (quote) => formatExportStatus(quote.discountType) },
  { header: "Discount", value: (quote) => centsToDecimal(quote.discountCents) },
  { header: "Tax Type", value: (quote) => formatExportStatus(quote.taxType) },
  { header: "Tax", value: (quote) => centsToDecimal(quote.taxCents) },
  { header: "Total", value: (quote) => centsToDecimal(quote.totalCents) },
  { header: "Item Count", value: (quote) => quote.items.length },
  { header: "Created At", value: (quote) => formatExportDateTime(quote.createdAt) },
  { header: "Updated At", value: (quote) => formatExportDateTime(quote.updatedAt) }
] satisfies Array<CsvColumn<ExportQuote>>;

function centsToDecimal(valueCents: number | null) {
  if (valueCents === null) return "";
  return (valueCents / 100).toFixed(2);
}

function formatExportDate(value: Date | string | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function formatExportDateTime(value: Date | string | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function formatExportStatus(value: string | null | undefined) {
  if (!value) return "";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
