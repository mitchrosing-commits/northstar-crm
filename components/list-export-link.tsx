import Link from "next/link";
import type { Route } from "next";
import { useId } from "react";

import type { ListSearchParams } from "@/lib/list-page-query";
import { listResourcePluralLabel, listResultSingularLabel } from "@/lib/list-resource-labels";
import type { ExportResource } from "@/lib/services/crm";

const ignoredExportParams = new Set(["page", "pageSize"]);
const ignoredExportScopeParams = new Set([...ignoredExportParams, "sortBy", "sortDirection"]);

type ListExportLinkProps = {
  className?: string;
  label?: string;
  matchingCount?: number;
  resource: ExportResource;
  searchParams: ListSearchParams;
  workspaceId: string;
};

export function ListExportLink({
  className = "button-secondary",
  label = "Export CSV",
  matchingCount,
  resource,
  searchParams,
  workspaceId
}: ListExportLinkProps) {
  const generatedHelperId = useId();
  const hasExportScopeParams = hasExportScopeSearchParams(searchParams);
  const helperText = exportHelperText(resource, matchingCount, hasExportScopeParams, hasExportSortParams(searchParams));
  const helperId = `${generatedHelperId}-${resource}-export-helper`;
  const exportActionLabel = `${label} for ${listResourcePluralLabel(resource)}: ${helperText}`;
  return (
    <span className="list-export-action">
      <Link
        aria-describedby={helperId}
        aria-label={exportActionLabel}
        className={className}
        href={buildListExportHref(workspaceId, resource, searchParams) as Route}
        title={exportActionLabel}
      >
        {label}
      </Link>
      <span className="list-export-helper" id={helperId}>
        {helperText}
      </span>
    </span>
  );
}

export function buildListExportHref(workspaceId: string, resource: ExportResource, searchParams: ListSearchParams) {
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (ignoredExportParams.has(key)) continue;
    for (const value of stringSearchParamValues(rawValue)) params.append(key, value);
  }

  const query = params.toString();
  const baseHref = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/exports/${resource}`;
  return query ? `${baseHref}?${query}` : baseHref;
}

export function hasExportSearchParams(searchParams: ListSearchParams) {
  return hasExportParams(searchParams, ignoredExportParams);
}

export function hasExportScopeSearchParams(searchParams: ListSearchParams) {
  return hasExportParams(searchParams, ignoredExportScopeParams);
}

export function hasExportSortParams(searchParams: ListSearchParams) {
  return stringSearchParamValues(searchParams.sortBy).length > 0 || stringSearchParamValues(searchParams.sortDirection).length > 0;
}

function hasExportParams(searchParams: ListSearchParams, ignoredParams: ReadonlySet<string>) {
  return Object.entries(searchParams).some(([key, rawValue]) => {
    if (ignoredParams.has(key)) return false;
    return stringSearchParamValues(rawValue).length > 0;
  });
}

function stringSearchParamValues(rawValue: ListSearchParams[string]) {
  const values = Array.isArray(rawValue) ? rawValue : [rawValue];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function exportHelperText(resource: ExportResource, matchingCount?: number, hasExportScopeParams = false, hasExportSortParams = false) {
  const pluralLabel = listResourcePluralLabel(resource);
  const singularLabel = listResultSingularLabel(resource);
  const sortCopy = hasExportSortParams ? " in the current sort order" : "";

  if (matchingCount === undefined) {
    return hasExportScopeParams
      ? `Downloads a CSV of all matching ${pluralLabel}${sortCopy}, not just this page`
      : `Downloads a CSV of all ${pluralLabel}${sortCopy}`;
  }
  if (matchingCount === 0) {
    return hasExportScopeParams
      ? `No matching ${pluralLabel}; downloads a header-only CSV`
      : `No ${pluralLabel} yet; downloads a header-only CSV`;
  }
  if (matchingCount === 1) {
    return hasExportScopeParams
      ? `Downloads a CSV with 1 matching ${singularLabel}${sortCopy}`
      : `Downloads a CSV with 1 ${singularLabel}${sortCopy}`;
  }
  return hasExportScopeParams
    ? `Downloads a CSV with all ${matchingCount} matching ${pluralLabel}${sortCopy}, not just this page`
    : `Downloads a CSV with all ${matchingCount} ${pluralLabel}${sortCopy}`;
}

export function fullWorkspaceExportHelperText({
  customFieldCount,
  rowCount
}: {
  customFieldCount: number;
  rowCount: number;
}) {
  if (rowCount === 0) {
    return customFieldCount > 0
      ? "No rows yet; downloads a header-only CSV with configured custom field columns."
      : "No rows yet; downloads a header-only CSV.";
  }

  return customFieldCount > 0
    ? "Full workspace export with configured custom field columns. List-page exports preserve search, filters, and sort."
    : "Full workspace export. List-page exports preserve search, filters, and sort.";
}

export function exportRowCountLabel(rowCount: number) {
  if (rowCount === 0) return "No rows";
  if (rowCount === 1) return "1 row";
  return `${rowCount} rows`;
}
