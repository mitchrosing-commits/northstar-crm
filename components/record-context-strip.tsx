import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type RecordContextStripItem = {
  href?: Route;
  label: string;
  meta?: ReactNode;
  tone?: "default" | "muted" | "warning" | "success";
  value: ReactNode;
};

type RecordContextStripProps = {
  ariaLabel: string;
  items: RecordContextStripItem[];
};

export function RecordContextStrip({ ariaLabel, items }: RecordContextStripProps) {
  if (items.length === 0) return null;

  return (
    <section className="record-context-strip" aria-label={ariaLabel}>
      <ul>
        {items.map((item) => {
          const className = item.tone && item.tone !== "default"
            ? `record-context-strip-item record-context-strip-item-${item.tone}`
            : "record-context-strip-item";
          const content = (
            <>
              <span>{item.label}</span>
              <div className="record-context-strip-value">{item.value}</div>
              {item.meta ? <small>{item.meta}</small> : null}
            </>
          );

          return (
            <li className={className} key={item.label}>
              {item.href ? (
                <Link href={item.href} title={item.label}>
                  {content}
                </Link>
              ) : (
                <div>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function recordContextCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
