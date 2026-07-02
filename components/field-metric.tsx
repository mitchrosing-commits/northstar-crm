import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

type FieldMetricProps = {
  actionLabel?: string;
  className?: string;
  href?: Route | string;
  label: string;
  value: ReactNode;
  valueClassName?: string;
};

export function FieldMetric({ actionLabel, className, href, label, value, valueClassName }: FieldMetricProps) {
  const resolvedActionLabel = actionLabel ?? `View ${label.toLowerCase()}`;
  const content = (
    <>
      <p className="field-label">{label}</p>
      <p className={["field-value", valueClassName].filter(Boolean).join(" ")}>{value}</p>
    </>
  );

  return href ? (
    <Link
      aria-label={resolvedActionLabel}
      className={["field-link", className].filter(Boolean).join(" ")}
      href={href as Route}
      title={resolvedActionLabel}
    >
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
