import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import {
  hasActiveListViewFilters,
  serializeListViewState,
  serializedListViewStateToSearchParams,
  type ListSearchParams,
  type ListViewState
} from "@/lib/list-page-query";

type SavedListView = {
  href: string;
  name: string;
};

type ListViewStatusProps = {
  active: boolean;
  label?: string;
  resetHref: string;
  resetLabel?: string;
  savedViewName?: string;
};

type ListViewStatusForStateProps = {
  label?: string;
  listState: ListViewState;
  resetHref: string;
  searchParams: ListSearchParams;
  savedViews: SavedListView[];
};

export function ListViewStatusForState({ label, listState, resetHref, searchParams, savedViews }: ListViewStatusForStateProps) {
  const savedViewName = hasExplicitListStateParams(searchParams, Object.keys(listState.filters))
    ? findMatchingSavedViewName(listState, savedViews)
    : undefined;
  return (
    <ListViewStatus
      active={Boolean(savedViewName) || hasActiveListViewFilters(listState)}
      label={label}
      resetHref={resetHref}
      savedViewName={savedViewName}
    />
  );
}

export function ListViewStatus({
  active,
  label = "Filtered view active",
  resetHref,
  resetLabel = "Clear filters",
  savedViewName
}: ListViewStatusProps) {
  if (!active) return null;
  const statusLabel = savedViewName ? `Saved view: ${savedViewName}` : label;
  const resolvedResetLabel = savedViewName ? "Clear saved view" : resetLabel;
  const resetActionLabel = `${resolvedResetLabel}: ${statusLabel}`;
  const statusAnnouncement = `${statusLabel}. ${resolvedResetLabel} available.`;

  return (
    <p
      aria-atomic="true"
      aria-label={statusAnnouncement}
      aria-live="polite"
      className="list-view-status"
      role="status"
      title={statusAnnouncement}
    >
      <Badge label={statusLabel}>{statusLabel}</Badge>
      <Link aria-label={resetActionLabel} className="inline-link" href={resetHref as Route} title={resetActionLabel}>
        {resolvedResetLabel}
      </Link>
    </p>
  );
}

export function findMatchingSavedViewName(listState: ListViewState, savedViews: SavedListView[]) {
  const currentStateKey = normalizedSearchParamsKey(serializedListViewStateToSearchParams(serializeListViewState(listState)));
  return savedViews.find((view) => normalizedSearchParamsKey(searchParamsFromHref(view.href)) === currentStateKey)?.name;
}

export function hasExplicitListStateParams(searchParams: ListSearchParams, filterKeys: string[] = []) {
  const listStateKeys = new Set(["q", "sortBy", "sortDirection", "pageSize", ...filterKeys]);
  return Array.from(listStateKeys).some((key) => hasSearchParamValue(searchParams[key]));
}

function hasSearchParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.some(Boolean);
  return Boolean(value);
}

function searchParamsFromHref(href: string) {
  const [, query = ""] = href.split("?");
  return new URLSearchParams(query);
}

function normalizedSearchParamsKey(params: URLSearchParams) {
  return Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}
