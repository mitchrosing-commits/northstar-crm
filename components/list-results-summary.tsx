import { Badge } from "@/components/badge";
import type { PageInfo } from "@/lib/list-page-query";

type ListResultsSummaryProps = {
  activeFilters: boolean;
  ariaLabel?: string;
  label: string;
  pageInfo: PageInfo;
};

export function ListResultsSummary({ activeFilters, ariaLabel = "List results summary", label, pageInfo }: ListResultsSummaryProps) {
  const summaryText = listResultsSummaryText(pageInfo, label, activeFilters);
  const scopeLabel = listResultsScopeLabel(pageInfo, label, activeFilters);
  const pageLabel = listResultsPageLabel(pageInfo);
  const resolvedAriaLabel =
    ariaLabel === "List results summary" ? listResultsAnnouncement(pageInfo, label, activeFilters) : ariaLabel;

  return (
    <div
      aria-atomic="true"
      aria-label={resolvedAriaLabel}
      aria-live="polite"
      className="list-results-summary"
      role="status"
      title={resolvedAriaLabel}
    >
      <p className="list-results-copy">{summaryText}</p>
      <span className="list-results-meta" aria-label={`${scopeLabel}. ${pageLabel}.`}>
        <Badge label={scopeLabel}>{scopeLabel}</Badge>
        <Badge label={pageLabel}>{pageLabel}</Badge>
      </span>
    </div>
  );
}

export function listResultsSummaryText(pageInfo: PageInfo, label: string, activeFilters = false) {
  if (pageInfo.total === 0) return activeFilters ? `No matching ${label} to show` : `No ${label} to show`;
  return `Showing ${pageInfo.from}-${pageInfo.to} of ${pageInfo.total} ${label}`;
}

export function listResultsScopeLabel(pageInfo: PageInfo, label: string, activeFilters: boolean) {
  if (pageInfo.total === 0) return activeFilters ? `No matching ${label}` : `No ${label} yet`;
  return activeFilters ? `Filtered ${label}` : `All ${label}`;
}

export function listResultsPageLabel(pageInfo: PageInfo) {
  return pageInfo.total === 0 ? "Page 0 of 0" : `Page ${pageInfo.page} of ${pageInfo.totalPages}`;
}

export function listResultsAnnouncement(pageInfo: PageInfo, label: string, activeFilters: boolean) {
  return `${listResultsSummaryText(pageInfo, label, activeFilters)}. ${listResultsScopeLabel(pageInfo, label, activeFilters)}. ${listResultsPageLabel(pageInfo)}.`;
}
