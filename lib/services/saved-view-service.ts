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
import { customFieldFilterOperators } from "@/lib/custom-field-display";
import {
  dealCommercialFilters,
  dealFilterKeys,
  dealSorts,
  dealStatuses,
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
  leadStatuses,
  type LeadListFilterKey,
  type LeadListSort
} from "@/lib/lead-list-state";
import {
  serializedListViewStateToSearchParams,
  sortDirections,
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
import { validateSavedViewName } from "@/lib/saved-view-validation";
import { prisma } from "@/lib/db/prisma";
import { ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

type SerializedDealListState = SerializedListViewState<DealListSort, DealListFilterKey>;
type SerializedLeadListState = SerializedListViewState<LeadListSort, LeadListFilterKey>;
type SerializedContactListState = SerializedListViewState<ContactListSort, ContactListFilterKey>;
type SerializedOrganizationListState = SerializedListViewState<OrganizationListSort, OrganizationListFilterKey>;
type SavedViewConfig<TSortBy extends string, TFilterKey extends string> = {
  filterValueOptions?: Partial<Record<TFilterKey, readonly string[]>>;
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
const followUpFilters = ["missing", "overdue", "today", "upcoming", "unscheduled"] as const;
const dealSavedViewConfig = {
  recordType: "DEAL",
  pathname: "/deals",
  defaultState: defaultDealSavedViewState,
  sortByValues: dealSorts,
  filterKeys: dealFilterKeys,
  filterValueOptions: {
    commercial: dealCommercialFilters,
    customFieldOperator: customFieldFilterOperators,
    followUp: followUpFilters,
    status: dealStatuses
  }
} as const satisfies SavedViewConfig<DealListSort, DealListFilterKey>;
const leadSavedViewConfig = {
  recordType: "LEAD",
  pathname: "/leads",
  defaultState: defaultLeadSavedViewState,
  sortByValues: leadSorts,
  filterKeys: leadFilterKeys,
  filterValueOptions: {
    customFieldOperator: customFieldFilterOperators,
    followUp: followUpFilters,
    status: leadStatuses
  }
} as const satisfies SavedViewConfig<LeadListSort, LeadListFilterKey>;
const contactSavedViewConfig = {
  recordType: "PERSON",
  pathname: "/contacts",
  defaultState: defaultContactSavedViewState,
  sortByValues: contactSorts,
  filterKeys: contactFilterKeys,
  filterValueOptions: {
    customFieldOperator: customFieldFilterOperators
  }
} as const satisfies SavedViewConfig<ContactListSort, ContactListFilterKey>;
const organizationSavedViewConfig = {
  recordType: "ORGANIZATION",
  pathname: "/organizations",
  defaultState: defaultOrganizationSavedViewState,
  sortByValues: organizationSorts,
  filterKeys: organizationFilterKeys,
  filterValueOptions: {
    customFieldOperator: customFieldFilterOperators
  }
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
  input: unknown
) {
  return createSavedView(actor, input, dealSavedViewConfig);
}

export async function createLeadSavedView(
  actor: WorkspaceActor,
  input: unknown
) {
  return createSavedView(actor, input, leadSavedViewConfig);
}

export async function createContactSavedView(
  actor: WorkspaceActor,
  input: unknown
) {
  return createSavedView(actor, input, contactSavedViewConfig);
}

export async function createOrganizationSavedView(
  actor: WorkspaceActor,
  input: unknown
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
  input: unknown,
  config: SavedViewConfig<TSortBy, TFilterKey>
) {
  await ensureWorkspaceAccess(actor);
  const savedViewInput = objectInput(input);
  const name = validateSavedViewName(savedViewInput.name);

  const state = normalizeSavedViewState(serializeSavedViewInputState(savedViewInput.state), config);
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

function serializeSavedViewInputState(value: unknown): Prisma.JsonValue {
  if (!isUnknownObject(value)) {
    throw new ApiError("VALIDATION_ERROR", "Saved view state is required.", 422);
  }

  const filters = isUnknownObject(value.filters) ? jsonPrimitiveObject(value.filters) : {};
  const pagination = isUnknownObject(value.pagination) ? value.pagination : {};
  return omitUndefined({
    q: jsonPrimitive(value.q),
    filters,
    sortBy: jsonPrimitive(value.sortBy),
    sortDirection: jsonPrimitive(value.sortDirection),
    pageSize: jsonPrimitive(pagination.pageSize ?? value.pageSize)
  }) as Prisma.JsonValue;
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
  const normalizedState = normalizeSavedViewState(state as unknown as Prisma.JsonValue, config);
  const query = serializedListViewStateToSearchParams(normalizedState).toString();
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
  if (!isJsonObject(value)) return cloneSerializedListViewState(config.defaultState);

  const q = typeof value.q === "string" && value.q.trim() ? value.q.trim() : undefined;
  const sortBy = stringIn(value.sortBy, config.sortByValues) ?? config.defaultState.sortBy;
  const sortDirection = stringIn(value.sortDirection, sortDirections) ?? config.defaultState.sortDirection;
  const pagination = isJsonObject(value.pagination) ? value.pagination : {};
  const pageSize = boundedPositiveInt(value.pageSize ?? pagination.pageSize, config.defaultState.pageSize, 1, 50);
  const filters = isJsonObject(value.filters) ? normalizeFilters(value.filters, config) : {};

  return {
    ...(q ? { q } : {}),
    filters,
    sortBy,
    sortDirection,
    pageSize
  };
}

function cloneSerializedListViewState<TSortBy extends string, TFilterKey extends string>(
  state: SerializedListViewState<TSortBy, TFilterKey>
): SerializedListViewState<TSortBy, TFilterKey> {
  return {
    ...state,
    filters: { ...state.filters }
  };
}

function normalizeFilters<TFilterKey extends string>(
  value: Record<string, Prisma.JsonValue>,
  config: SavedViewConfig<string, TFilterKey>
) {
  const filters: Partial<Record<TFilterKey, string>> = {};
  for (const key of config.filterKeys) {
    const filterValue = value[key];
    if (typeof filterValue !== "string" || !filterValue.trim()) continue;
    const normalizedValue = filterValue.trim();
    const allowedValues = config.filterValueOptions?.[key];
    if (allowedValues && !allowedValues.includes(normalizedValue)) continue;
    filters[key] = normalizedValue;
  }
  normalizeCustomFieldFilterGroup(value, filters);
  return filters;
}

function normalizeCustomFieldFilterGroup<TFilterKey extends string>(
  value: Record<string, Prisma.JsonValue>,
  filters: Partial<Record<TFilterKey, string>>
) {
  const customFieldIdKey = "customFieldId" as TFilterKey;
  const customFieldOperatorKey = "customFieldOperator" as TFilterKey;
  const customFieldValueKey = "customFieldValue" as TFilterKey;
  const rawOperator = value.customFieldOperator;
  const rawOperatorText = typeof rawOperator === "string" ? rawOperator.trim() : "";
  const invalidExplicitOperator =
    Boolean(rawOperatorText) &&
    !customFieldFilterOperators.includes(rawOperatorText as (typeof customFieldFilterOperators)[number]);

  if (invalidExplicitOperator || !filters[customFieldIdKey]) {
    delete filters[customFieldIdKey];
    delete filters[customFieldOperatorKey];
    delete filters[customFieldValueKey];
    return;
  }

  const customFieldOperator = filters[customFieldOperatorKey] ?? "equals";

  if (customFieldOperator === "is_empty" || customFieldOperator === "is_not_empty") {
    delete filters[customFieldValueKey];
    return;
  }

  if (!filters[customFieldValueKey]) {
    delete filters[customFieldIdKey];
    delete filters[customFieldOperatorKey];
    delete filters[customFieldValueKey];
  }
}

function isJsonObject(value: Prisma.JsonValue): value is Record<string, Prisma.JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectInput(input: unknown): Record<string, unknown> {
  return isUnknownObject(input) ? input : {};
}

function jsonPrimitive(value: unknown): Prisma.JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function jsonPrimitiveObject(input: Record<string, unknown>): Record<string, Prisma.JsonValue> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, jsonPrimitive(value)] as const)
      .filter((entry): entry is readonly [string, Prisma.JsonValue] => entry[1] !== undefined)
  );
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function stringIn<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : undefined;
}

function boundedPositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined || parsed < min) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function parsePositiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
