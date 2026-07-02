import Link from "next/link";
import type { Route } from "next";

import { ActionGroup } from "@/components/action-group";

type ListRowAction = {
  ariaLabel?: string;
  href: string;
  label: string;
};

type ListRowActionsProps = {
  "aria-label"?: string;
  actions: ListRowAction[];
};

export function ListRowActions({ "aria-label": ariaLabel = "Row actions", actions }: ListRowActionsProps) {
  if (actions.length === 0) return null;

  const groupLabel = `${ariaLabel}: ${actions.length} ${actions.length === 1 ? "action" : "actions"}`;

  return (
    <ActionGroup className="table-row-actions" label={groupLabel}>
      {actions.map((action) => {
        const actionLabel = action.ariaLabel ?? action.label;

        return (
          <Link
            aria-label={actionLabel}
            className="button-secondary button-compact"
            href={action.href as Route}
            key={`${action.href}-${action.label}`}
            title={actionLabel}
          >
            {action.label}
          </Link>
        );
      })}
    </ActionGroup>
  );
}
