import Link from "next/link";
import type { Route } from "next";

import { listResultSingularLabel } from "@/lib/list-resource-labels";

type ListEmptyStateActionsProps = {
  clearHref: Route;
  createFromQueryHref?: Route;
  createFromQueryLabel?: string;
  createHref: Route;
  createLabel: string;
  hasActiveFilters: boolean;
  resultLabel: string;
};

export function ListEmptyStateActions({
  clearHref,
  createFromQueryHref,
  createFromQueryLabel,
  createHref,
  createLabel,
  hasActiveFilters,
  resultLabel
}: ListEmptyStateActionsProps) {
  const clearActionLabel = `Clear filters and show all ${resultLabel}`;
  const createFromQueryActionLabel = createFromQueryLabel ? `${createFromQueryLabel}: use the current search text` : undefined;
  const createActionLabel = `${createLabel}: add a new ${listResultSingularLabel(resultLabel)} record`;

  if (hasActiveFilters) {
    const fallbackCreateAction = createFromQueryHref && createFromQueryLabel ? null : (
      <Link aria-label={createActionLabel} className="button-secondary" href={createHref} title={createActionLabel}>
        {createLabel}
      </Link>
    );

    return (
      <>
        <Link aria-label={clearActionLabel} className="button-primary" href={clearHref} title={clearActionLabel}>
          Clear filters
        </Link>
        {createFromQueryHref && createFromQueryLabel ? (
          <Link
            aria-label={createFromQueryActionLabel}
            className="button-secondary"
            href={createFromQueryHref}
            title={createFromQueryActionLabel}
          >
            {createFromQueryLabel}
          </Link>
        ) : null}
        {fallbackCreateAction}
      </>
    );
  }

  return (
    <Link aria-label={createActionLabel} className="button-primary" href={createHref} title={createActionLabel}>
      {createLabel}
    </Link>
  );
}
