import type { Route } from "next";
import Link from "next/link";

import { paginationHref, type ListSearchParams, type PageInfo } from "@/lib/list-page-query";

type PaginationControlsProps = {
  basePath: string;
  pageInfo: PageInfo;
  searchParams: ListSearchParams;
};

export function PaginationControls({ basePath, pageInfo, searchParams }: PaginationControlsProps) {
  const previousHref = paginationHref(basePath, searchParams, pageInfo.page - 1, pageInfo.pageSize);
  const nextHref = paginationHref(basePath, searchParams, pageInfo.page + 1, pageInfo.pageSize);

  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="pagination-summary" aria-live="polite">
        {pageInfo.total === 0
          ? "Showing 0 results"
          : `Showing ${pageInfo.from}-${pageInfo.to} of ${pageInfo.total}`}
      </p>
      <div className="pagination-actions">
        {pageInfo.hasPreviousPage ? (
          <Link className="button-secondary button-compact" href={previousHref as Route} rel="prev">
            Previous
          </Link>
        ) : (
          <span className="button-secondary button-compact pagination-disabled" aria-disabled="true">
            Previous
          </span>
        )}
        <span className="pagination-page">
          Page {pageInfo.page} of {pageInfo.totalPages}
        </span>
        {pageInfo.hasNextPage ? (
          <Link className="button-secondary button-compact" href={nextHref as Route} rel="next">
            Next
          </Link>
        ) : (
          <span className="button-secondary button-compact pagination-disabled" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
