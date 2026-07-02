import type { Route } from "next";
import Link from "next/link";

import { ActionGroup } from "@/components/action-group";
import { paginationHref, type ListSearchParams, type PageInfo } from "@/lib/list-page-query";

type PaginationControlsProps = {
  ariaLabel?: string;
  basePath: string;
  pageInfo: PageInfo;
  searchParams: ListSearchParams;
};

export function PaginationControls({ ariaLabel = "Pagination", basePath, pageInfo, searchParams }: PaginationControlsProps) {
  const previousHref = paginationHref(basePath, searchParams, pageInfo.page - 1, pageInfo.pageSize);
  const nextHref = paginationHref(basePath, searchParams, pageInfo.page + 1, pageInfo.pageSize);
  const previousLabel = pageInfo.hasPreviousPage ? `Go to page ${pageInfo.page - 1}` : "Previous page unavailable";
  const nextLabel = pageInfo.hasNextPage ? `Go to page ${pageInfo.page + 1}` : "Next page unavailable";
  const currentPageLabel = `Page ${pageInfo.page} of ${pageInfo.totalPages}`;
  const actionsLabel = `${ariaLabel} actions for ${currentPageLabel.toLowerCase()}`;
  const summaryLabel = paginationSummaryLabel(pageInfo);

  return (
    <nav className="pagination" aria-label={ariaLabel}>
      <p
        aria-atomic="true"
        aria-label={`${summaryLabel}. ${currentPageLabel}.`}
        aria-live="polite"
        className="pagination-summary"
        role="status"
        title={`${summaryLabel}. ${currentPageLabel}.`}
      >
        {summaryLabel}
      </p>
      <ActionGroup className="pagination-actions" label={actionsLabel}>
        {pageInfo.hasPreviousPage ? (
          <Link
            aria-label={previousLabel}
            className="button-secondary button-compact"
            href={previousHref as Route}
            rel="prev"
            title={previousLabel}
          >
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            aria-label={previousLabel}
            className="button-secondary button-compact pagination-disabled"
            title={previousLabel}
          >
            Previous
          </span>
        )}
        <span aria-current="page" className="pagination-page" title={currentPageLabel}>
          {currentPageLabel}
        </span>
        {pageInfo.hasNextPage ? (
          <Link
            aria-label={nextLabel}
            className="button-secondary button-compact"
            href={nextHref as Route}
            rel="next"
            title={nextLabel}
          >
            Next
          </Link>
        ) : (
          <span
            aria-disabled="true"
            aria-label={nextLabel}
            className="button-secondary button-compact pagination-disabled"
            title={nextLabel}
          >
            Next
          </span>
        )}
      </ActionGroup>
    </nav>
  );
}

export function paginationSummaryLabel(pageInfo: PageInfo) {
  return pageInfo.total === 0 ? "Showing 0 results" : `Showing ${pageInfo.from}-${pageInfo.to} of ${pageInfo.total}`;
}
