import Link from "next/link";
import type { Route } from "next";
import { useId, type ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";

type FilterPanelProps = {
  action: string;
  children: ReactNode;
  legend?: string;
  pageSize?: number;
  resetHref: string;
};

export function FilterPanel({ action, children, legend = "Filters", pageSize, resetHref }: FilterPanelProps) {
  const generatedHelperId = useId();
  const helperId = `${generatedHelperId}-filter-help`;
  const applyLabel = `Apply ${legend.toLowerCase()}`;
  const clearLabel = `Clear ${legend.toLowerCase()} and show all results`;
  const actionsLabel = `${legend} actions`;

  return (
    <section aria-label={legend} className="panel filter-panel">
      <form aria-describedby={helperId} className="filter-form" action={action}>
        <p className="sr-only" id={helperId}>
          Apply filters to update this list. Clear filters returns to the full list.
        </p>
        {pageSize ? <input name="pageSize" type="hidden" value={pageSize} /> : null}
        <fieldset className="filter-fieldset">
          <legend className="sr-only">{legend}</legend>
          <div className="filter-form-grid">
            {children}
            <ActionGroup className="filter-actions" label={actionsLabel}>
              <button aria-label={applyLabel} className="button-primary" title={applyLabel} type="submit">
                Apply
              </button>
              <Link aria-label={clearLabel} className="button-secondary" href={resetHref as Route} title={clearLabel}>
                Clear filters
              </Link>
            </ActionGroup>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
