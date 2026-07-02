import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { InlineEmptyStateText } from "@/components/inline-empty-state-text";

type TableLinkedRecordCellProps = {
  href?: string;
  children?: ReactNode;
  emptyLabel?: string;
  linkLabel?: string;
};

export function TableLinkedRecordCell({
  href,
  children,
  emptyLabel = "No linked record",
  linkLabel
}: TableLinkedRecordCellProps) {
  if (!href || !children) {
    return <InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>;
  }

  return (
    <Link aria-label={linkLabel} className="inline-link" href={href as Route} title={linkLabel}>
      {children}
    </Link>
  );
}
