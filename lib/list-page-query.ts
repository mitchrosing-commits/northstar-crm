export type ListSearchParams = Record<string, string | string[] | undefined>;
export type SortDirection = "asc" | "desc";
export type PaginationInput = {
  page: number;
  pageSize: number;
};
export type ListViewState<TSortBy extends string = string, TFilterKey extends string = string> = {
  q?: string;
  filters: Record<TFilterKey, string | undefined>;
  sortBy: TSortBy;
  sortDirection: SortDirection;
  pagination: PaginationInput;
};
export type SerializedListViewState<TSortBy extends string = string, TFilterKey extends string = string> = {
  q?: string;
  filters: Partial<Record<TFilterKey, string>>;
  sortBy: TSortBy;
  sortDirection: SortDirection;
  pageSize: number;
};
export type PageInfo = PaginationInput & {
  total: number;
  totalPages: number;
  skip: number;
  from: number;
  to: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

const defaultPageSize = 10;
const maxPageSize = 50;
export const sortDirections = ["asc", "desc"] as const;

export function getSearchParam(searchParams: ListSearchParams, key: string) {
  const value = searchParams[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function optionalSearchParam(searchParams: ListSearchParams, key: string) {
  const value = getSearchParam(searchParams, key).trim();
  return value.length > 0 ? value : undefined;
}

export function enumSearchParam<T extends string>(
  searchParams: ListSearchParams,
  key: string,
  allowed: readonly T[]
) {
  const value = optionalSearchParam(searchParams, key);
  return value && allowed.includes(value as T) ? (value as T) : undefined;
}

export function hasActiveListFilters(searchParams: ListSearchParams, keys: readonly string[]) {
  return keys.some((key) => Boolean(optionalSearchParam(searchParams, key)));
}

export function parseListViewState<TSortBy extends string, TFilterKey extends string = string>(
  searchParams: ListSearchParams,
  options: {
    defaultSortBy: TSortBy;
    defaultSortDirection: SortDirection;
    filterKeys: readonly TFilterKey[];
    sortByValues: readonly TSortBy[];
  }
): ListViewState<TSortBy, TFilterKey> {
  return {
    q: optionalSearchParam(searchParams, "q"),
    filters: Object.fromEntries(options.filterKeys.map((key) => [key, optionalSearchParam(searchParams, key)])) as Record<
      TFilterKey,
      string | undefined
    >,
    sortBy: enumSearchParam(searchParams, "sortBy", options.sortByValues) ?? options.defaultSortBy,
    sortDirection: enumSearchParam(searchParams, "sortDirection", sortDirections) ?? options.defaultSortDirection,
    pagination: parsePagination(searchParams)
  };
}

export function enumListViewFilter<T extends string, TFilterKey extends string = string>(
  state: ListViewState<string, TFilterKey>,
  key: TFilterKey,
  allowed: readonly T[]
) {
  const value = state.filters[key];
  return value && allowed.includes(value as T) ? (value as T) : undefined;
}

export function hasActiveListViewFilters(state: ListViewState) {
  return Boolean(state.q) || Object.values(state.filters).some(Boolean);
}

export function serializeListViewState<TSortBy extends string, TFilterKey extends string>(
  state: ListViewState<TSortBy, TFilterKey>
): SerializedListViewState<TSortBy, TFilterKey> {
  return {
    q: state.q,
    filters: Object.fromEntries(
      Object.entries(state.filters).filter((entry): entry is [string, string] => Boolean(entry[1]))
    ) as Partial<Record<TFilterKey, string>>,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    pageSize: state.pagination.pageSize
  };
}

export function serializedListViewStateToSearchParams(state: SerializedListViewState) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);

  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }

  params.set("sortBy", state.sortBy);
  params.set("sortDirection", state.sortDirection);
  params.set("pageSize", String(state.pageSize));
  return params;
}

export function parsePagination(searchParams: ListSearchParams): PaginationInput {
  return {
    page: positiveInt(getSearchParam(searchParams, "page"), 1),
    pageSize: clamp(positiveInt(getSearchParam(searchParams, "pageSize"), defaultPageSize), 1, maxPageSize)
  };
}

export function resolvePagination(total: number, pagination: PaginationInput): PageInfo {
  const pageSize = clamp(pagination.pageSize, 1, maxPageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = clamp(pagination.page, 1, totalPages);
  const skip = total === 0 ? 0 : (page - 1) * pageSize;
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(total, skip + pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages,
    skip,
    from,
    to,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages
  };
}

export function paginationHref(pathname: string, searchParams: ListSearchParams, page: number, pageSize: number) {
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (key === "page" || key === "pageSize") continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value) params.append(key, value);
    }
  }

  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `${pathname}?${params.toString()}`;
}

function positiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
