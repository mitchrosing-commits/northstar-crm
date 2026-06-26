import type { SortDirection } from "@/lib/list-page-query";

export const organizationSorts = ["name", "createdAt", "updatedAt"] as const;
export const organizationFilterKeys = ["ownerId", "customFieldId", "customFieldOperator", "customFieldValue"] as const;

export type OrganizationListSort = (typeof organizationSorts)[number];
export type OrganizationListFilterKey = (typeof organizationFilterKeys)[number];

export const defaultOrganizationListSortBy = "name" satisfies OrganizationListSort;
export const defaultOrganizationListSortDirection = "asc" satisfies SortDirection;

export const organizationListStateOptions = {
  defaultSortBy: defaultOrganizationListSortBy,
  defaultSortDirection: defaultOrganizationListSortDirection,
  filterKeys: organizationFilterKeys,
  sortByValues: organizationSorts
} as const satisfies {
  defaultSortBy: OrganizationListSort;
  defaultSortDirection: SortDirection;
  filterKeys: readonly OrganizationListFilterKey[];
  sortByValues: readonly OrganizationListSort[];
};
