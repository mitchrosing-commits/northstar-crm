import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

type StatCardProps = {
  actionLabel?: string;
  href?: Route | string;
  label: string;
  value: ReactNode;
  valueClassName?: string;
};

export function StatCard({ actionLabel, href, label, value, valueClassName }: StatCardProps) {
  const resolvedActionLabel = actionLabel ?? `View ${label.toLowerCase()}`;
  const content = (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className={["stat-value", valueClassName].filter(Boolean).join(" ")}>{value}</p>
    </div>
  );

  return href ? (
    <Link aria-label={resolvedActionLabel} className="stat-card-link" href={href as Route} title={resolvedActionLabel}>
      {content}
    </Link>
  ) : (
    content
  );
}
