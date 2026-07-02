import type { SortDirection } from "@/lib/list-page-query";

export const leadStatuses = ["NEW", "QUALIFIED", "DISQUALIFIED", "CONVERTED"] as const;
export const leadSorts = ["updatedAt", "createdAt", "title"] as const;
export const leadFilterKeys = ["status", "source", "ownerId", "followUp", "customFieldId", "customFieldOperator", "customFieldValue"] as const;

export type LeadListStatus = (typeof leadStatuses)[number];
export type LeadListSort = (typeof leadSorts)[number];
export type LeadListFilterKey = (typeof leadFilterKeys)[number];

export const defaultLeadListSortBy = "updatedAt" satisfies LeadListSort;
export const defaultLeadListSortDirection = "desc" satisfies SortDirection;

export const leadListStateOptions = {
  defaultSortBy: defaultLeadListSortBy,
  defaultSortDirection: defaultLeadListSortDirection,
  filterKeys: leadFilterKeys,
  sortByValues: leadSorts
} as const satisfies {
  defaultSortBy: LeadListSort;
  defaultSortDirection: SortDirection;
  filterKeys: readonly LeadListFilterKey[];
  sortByValues: readonly LeadListSort[];
};
