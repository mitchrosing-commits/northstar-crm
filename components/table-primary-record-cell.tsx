import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type TablePrimaryRecordCellProps = {
  href: string;
  linkLabel?: string;
  title: ReactNode;
  secondary?: ReactNode;
  className?: string;
};

export function TablePrimaryRecordCell({
  href,
  linkLabel,
  title,
  secondary,
  className
}: TablePrimaryRecordCellProps) {
  return (
    <span className={["table-primary-cell", className].filter(Boolean).join(" ")}>
      <Link aria-label={linkLabel} className="inline-link" href={href as Route} title={linkLabel}>
        <strong>{title}</strong>
      </Link>
      {secondary ? <span className="table-secondary-text">{secondary}</span> : null}
    </span>
  );
}
