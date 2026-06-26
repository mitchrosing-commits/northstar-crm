import { Prisma, type SavedView, type SavedViewRecordType } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import {
  contactFilterKeys,
  contactSorts,
  defaultContactListSortBy,
  defaultContactListSortDirection,
  type ContactListFilterKey,
  type ContactListSort
} from "@/lib/contact-list-state";
import {
  dealFilterKeys,
  dealSorts,
  defaultDealListSortBy,
  defaultDealListSortDirection,
  type DealListFilterKey,
  type DealListSort
} from "@/lib/deal-list-state";
import {
  defaultLeadListSortBy,
  defaultLeadListSortDirection,
  leadFilterKeys,
  leadSorts,
  type LeadListFilterKey,
  type LeadListSort
} from "@/lib/lead-list-state";
import {
  serializeListViewState,
  serializedListViewStateToSearchParams,
  sortDirections,
  type ListViewState,
  type SerializedListViewState
} from "@/lib/list-page-query";
import {
  defaultOrganizationListSortBy,
  defaultOrganizationListSortDirection,
  organizationFilterKeys,
  organizationSorts,
  type OrganizationListFilterKey,
  type OrganizationListSort
} from "@/lib/organization-list-state";
import { prisma } from "@/lib/db/prisma";
import { ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

type SerializedDealListState = SerializedListViewState<DealListSort, DealListFilterKey>;
type SerializedLeadListState = SerializedListViewState<LeadListSort, LeadListFilterKey>;
type SerializedContactListState = SerializedListViewState<ContactListSort, ContactListFilterKey>;
type SerializedOrganizationListState = SerializedListViewState<OrganizationListSort, OrganizationListFilterKey>;
type SavedViewConfig<TSortBy extends string, TFilterKey extends string> = {
  recordType: SavedViewRecordType;
  pathname: string;
  defaultState: SerializedListViewState<TSortBy, TFilterKey>;
  sortByValues: readonly TSortBy[];
  filterKeys: readonly TFilterKey[];
};

const defaultDealSavedViewState: SerializedDealListState = {
  filters: {},
  sortBy: defaultDealListSortBy,
  sortDirection: defaultDealListSortDirection,
  pageSize: 10
};
const defaultLeadSavedViewState: SerializedLeadListState = {
  filters: {},
  sortBy: defaultLeadListSortBy,
  sortDirection: defaultLeadListSortDirection,
  pageSize: 10
};
const defaultContactSavedViewState: SerializedContactListState = {
  filters: {},
  sortBy: defaultContactListSortBy,
  sortDirection: defaultContactListSortDirection,
  pageSize: 10
};
const defaultOrganizationSavedViewState: SerializedOrganizationListState = {
  filters: {},
  sortBy: defaultOrganizationListSortBy,
  sortDirection: defaultOrganizationListSortDirection,
  pageSize: 10
};
const dealSavedViewConfig = {
  recordType: "DEAL",
  pathname: "/deals",
  defaultState: defaultDealSavedViewState,
  sortByValues: dealSorts,
  filterKeys: dealFilterKeys
} as const satisfies SavedViewConfig<DealListSort, DealListFilterKey>;
const leadSavedViewConfig = {
  recordType: "LEAD",
  pathname: "/leads",
  defaultState: defaultLeadSavedViewState,
  sortByValues: leadSorts,
  filterKeys: leadFilterKeys
} as const satisfies SavedViewConfig<LeadListSort, LeadListFilterKey>;
const contactSavedViewConfig = {
  recordType: "PERSON",
  pathname: "/contacts",
  defaultState: defaultContactSavedViewState,
  sortByValues: contactSorts,
  filterKeys: contactFilterKeys
} as const satisfies SavedViewConfig<ContactListSort, ContactListFilterKey>;
const organizationSavedViewConfig = {
  recordType: "ORGANIZATION",
  pathname: "/organizations",
  defaultState: defaultOrganizationSavedViewState,
  sortByValues: organizationSorts,
  filterKeys: organizationFilterKeys
} as const satisfies SavedViewConfig<OrganizationListSort, OrganizationListFilterKey>;

export type DealSavedView = Omit<SavedView, "state"> & {
  state: SerializedDealListState;
  href: string;
};
export type LeadSavedView = Omit<SavedView, "state"> & {
  state: SerializedLeadListState;
  href: string;
};
export type ContactSavedView = Omit<SavedView, "state"> & {
  state: SerializedContactListState;
  href: string;
};
export type OrganizationSavedView = Omit<SavedView, "state"> & {
  state: SerializedOrganizationListState;
  href: string;
};

export async function listDealSavedViews(actor: WorkspaceActor) {
  return listSavedViews(actor, dealSavedViewConfig);
}

export async function listLeadSavedViews(actor: WorkspaceActor) {
  return listSavedViews(actor, leadSavedViewConfig);
}

export async function listContactSavedViews(actor: WorkspaceActor) {
  return listSavedViews(actor, contactSavedViewConfig);
}

export async function listOrganizationSavedViews(actor: WorkspaceActor) {
  return listSavedViews(actor, organizationSavedViewConfig);
}

export async function createDealSavedView(
  actor: WorkspaceActor,
  input: {
    name: string;
    state: ListViewState<DealListSort, DealListFilterKey>;
  }
) {
  return createSavedView(actor, input, dealSavedViewConfig);
}

export async function createLeadSavedView(
  actor: WorkspaceActor,
  input: {
    name: string;
    state: ListViewState<LeadListSort, LeadListFilterKey>;
  }
) {
  return createSavedView(actor, input, leadSavedViewConfig);
}

export async function createContactSavedView(
  actor: WorkspaceActor,
  input: {
    name: string;
    state: ListViewState<ContactListSort, ContactListFilterKey>;
  }
) {
  return createSavedView(actor, input, contactSavedViewConfig);
}

export async function createOrganizationSavedView(
  actor: WorkspaceActor,
  input: {
    name: string;
    state: ListViewState<OrganizationListSort, OrganizationListFilterKey>;
  }
) {
  return createSavedView(actor, input, organizationSavedViewConfig);
}

export async function deleteDealSavedView(actor: WorkspaceActor, savedViewId: string) {
  return deleteSavedView(actor, savedViewId, dealSavedViewConfig);
}

export async function deleteLeadSavedView(actor: WorkspaceActor, savedViewId: string) {
  return deleteSavedView(actor, savedViewId, leadSavedViewConfig);
}

export async function deleteContactSavedView(actor: WorkspaceActor, savedViewId: string) {
  return deleteSavedView(actor, savedViewId, contactSavedViewConfig);
}

export async function deleteOrganizationSavedView(actor: WorkspaceActor, savedViewId: string) {
  return deleteSavedView(actor, savedViewId, organizationSavedViewConfig);
}

export function dealSavedViewHref(state: SerializedDealListState) {
  return savedViewHref(state, dealSavedViewConfig);
}

export function leadSavedViewHref(state: SerializedLeadListState) {
  return savedViewHref(state, leadSavedViewConfig);
}

export function contactSavedViewHref(state: SerializedContactListState) {
  return savedViewHref(state, contactSavedViewConfig);
}

export function organizationSavedViewHref(state: SerializedOrganizationListState) {
  return savedViewHref(state, organizationSavedViewConfig);
}

async function listSavedViews<TSortBy extends string, TFilterKey extends string>(
  actor: WorkspaceActor,
  config: SavedViewConfig<TSortBy, TFilterKey>
) {
  await ensureWorkspaceAccess(actor);
  const views = await prisma.savedView.findMany({
    where: { workspaceId: actor.workspaceId, recordType: config.recordType },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
  });

  return views.map((view) => savedViewFromRecord(view, config));
}

async function createSavedView<TSortBy extends string, TFilterKey extends string>(
  actor: WorkspaceActor,
  input: {
    name: string;
    state: ListViewState<TSortBy, TFilterKey>;
  },
  config: SavedViewConfig<TSortBy, TFilterKey>
) {
  await ensureWorkspaceAccess(actor);
  const name = input.name.trim();
  if (!name) throw new ApiError("VALIDATION_ERROR", "Saved view name is required.", 422);

  const state = serializeListViewState(input.state);
  const view = await prisma.savedView.create({
    data: {
      workspaceId: actor.workspaceId,
      recordType: config.recordType,
      name,
      state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue
    }
  });

  return savedViewFromRecord(view, config);
}

async function deleteSavedView<TSortBy extends string, TFilterKey extends string>(
  actor: WorkspaceActor,
  savedViewId: string,
  config: SavedViewConfig<TSortBy, TFilterKey>
) {
  await ensureWorkspaceAccess(actor);
  const existing = await prisma.savedView.findFirst({
    where: { id: savedViewId, workspaceId: actor.workspaceId, recordType: config.recordType },
    select: { id: true }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Saved view was not found.", 404);
  await prisma.savedView.delete({ where: { id: savedViewId } });
}

function savedViewHref<TSortBy extends string, TFilterKey extends string>(
  state: SerializedListViewState<TSortBy, TFilterKey>,
  config: SavedViewConfig<TSortBy, TFilterKey>
) {
  const query = serializedListViewStateToSearchParams(state).toString();
  return query ? `${config.pathname}?${query}` : config.pathname;
}

function savedViewFromRecord<TSortBy extends string, TFilterKey extends string>(
  view: SavedView,
  config: SavedViewConfig<TSortBy, TFilterKey>
) {
  const state = normalizeSavedViewState(view.state, config);
  return {
    ...view,
    state,
    href: savedViewHref(state, config)
  };
}

function normalizeSavedViewState<TSortBy extends string, TFilterKey extends string>(
  value: Prisma.JsonValue,
  config: SavedViewConfig<TSortBy, TFilterKey>
): SerializedListViewState<TSortBy, TFilterKey> {
  if (!isJsonObject(value)) return config.defaultState;

  const q = typeof value.q === "string" && value.q.trim() ? value.q.trim() : undefined;
  const sortBy = stringIn(value.sortBy, config.sortByValues) ?? config.defaultState.sortBy;
  const sortDirection = stringIn(value.sortDirection, sortDirections) ?? config.defaultState.sortDirection;
  const pageSize = boundedPositiveInt(value.pageSize, config.defaultState.pageSize, 1, 50);
  const filters = isJsonObject(value.filters) ? normalizeFilters(value.filters, config.filterKeys) : {};

  return {
    ...(q ? { q } : {}),
    filters,
    sortBy,
    sortDirection,
    pageSize
  };
}

function normalizeFilters<TFilterKey extends string>(
  value: Record<string, Prisma.JsonValue>,
  filterKeys: readonly TFilterKey[]
) {
  const filters: Partial<Record<TFilterKey, string>> = {};
  for (const key of filterKeys) {
    const filterValue = value[key];
    if (typeof filterValue === "string" && filterValue.trim()) filters[key] = filterValue.trim();
  }
  return filters;
}

function isJsonObject(value: Prisma.JsonValue): value is Record<string, Prisma.JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringIn<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : undefined;
}

function boundedPositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(Math.trunc(parsed), max);
}
