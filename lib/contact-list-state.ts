import type { SortDirection } from "@/lib/list-page-query";

export const contactSorts = ["name", "createdAt", "updatedAt"] as const;
export const contactFilterKeys = ["organizationId", "ownerId", "customFieldId", "customFieldOperator", "customFieldValue"] as const;

export type ContactListSort = (typeof contactSorts)[number];
export type ContactListFilterKey = (typeof contactFilterKeys)[number];

export const defaultContactListSortBy = "name" satisfies ContactListSort;
export const defaultContactListSortDirection = "asc" satisfies SortDirection;

export const contactListStateOptions = {
  defaultSortBy: defaultContactListSortBy,
  defaultSortDirection: defaultContactListSortDirection,
  filterKeys: contactFilterKeys,
  sortByValues: contactSorts
} as const satisfies {
  defaultSortBy: ContactListSort;
  defaultSortDirection: SortDirection;
  filterKeys: readonly ContactListFilterKey[];
  sortByValues: readonly ContactListSort[];
};
