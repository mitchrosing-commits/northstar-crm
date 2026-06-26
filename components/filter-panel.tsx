import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type FilterPanelProps = {
  action: string;
  children: ReactNode;
  legend?: string;
  pageSize?: number;
  resetHref: string;
};

export function FilterPanel({ action, children, legend = "Filters", pageSize, resetHref }: FilterPanelProps) {
  return (
    <section className="panel filter-panel">
      <form className="filter-form" action={action}>
        {pageSize ? <input name="pageSize" type="hidden" value={pageSize} /> : null}
        <fieldset className="filter-fieldset">
          <legend className="sr-only">{legend}</legend>
          <div className="filter-form-grid">
            {children}
            <div className="filter-actions">
              <button className="button-primary" type="submit">
                Apply
              </button>
              <Link className="button-secondary" href={resetHref as Route}>
                Clear filters
              </Link>
            </div>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
