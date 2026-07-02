import type { SortDirection } from "@/lib/list-page-query";

export const dealStatuses = ["OPEN", "WON", "LOST"] as const;
export const dealSorts = ["updatedAt", "createdAt", "title", "valueCents", "expectedCloseAt"] as const;
export const dealFilterKeys = [
  "status",
  "stageId",
  "ownerId",
  "personId",
  "organizationId",
  "followUp",
  "commercial",
  "customFieldId",
  "customFieldOperator",
  "customFieldValue"
] as const;

export const dealCommercialFilters = ["noQuote", "hasQuote", "acceptedQuote", "valueNoLineItems"] as const;

export type DealListStatus = (typeof dealStatuses)[number];
export type DealListSort = (typeof dealSorts)[number];
export type DealListFilterKey = (typeof dealFilterKeys)[number];
export type DealCommercialFilter = (typeof dealCommercialFilters)[number];

export const defaultDealListSortBy = "updatedAt" satisfies DealListSort;
export const defaultDealListSortDirection = "desc" satisfies SortDirection;

export const dealListStateOptions = {
  defaultSortBy: defaultDealListSortBy,
  defaultSortDirection: defaultDealListSortDirection,
  filterKeys: dealFilterKeys,
  sortByValues: dealSorts
} as const satisfies {
  defaultSortBy: DealListSort;
  defaultSortDirection: SortDirection;
  filterKeys: readonly DealListFilterKey[];
  sortByValues: readonly DealListSort[];
};
