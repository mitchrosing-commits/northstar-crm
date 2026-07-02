import { useId, type ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";

export type RecordSummaryTone = "default" | "success" | "warning" | "danger" | "muted";

export type RecordSummaryItem = {
  label: string;
  tone?: RecordSummaryTone;
  value: ReactNode;
};

type RecordSummaryProps = {
  actions?: ReactNode;
  actionsLabel?: string;
  children?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  items?: RecordSummaryItem[];
  title: string;
};

export function RecordSummary({
  actions,
  actionsLabel = "Record workspace actions",
  children,
  description,
  eyebrow,
  items = [],
  title
}: RecordSummaryProps) {
  const titleId = `${useId()}-record-summary-title`;
  const resolvedActionsLabel =
    actionsLabel === "Record workspace actions" ? `${title} actions` : actionsLabel;

  return (
    <section className="record-summary" aria-labelledby={titleId}>
      <div className="record-summary-heading">
        <div>
          {eyebrow ? <p className="page-kicker">{eyebrow}</p> : null}
          <h2 id={titleId}>{title}</h2>
          {description ? <p className="record-summary-description">{description}</p> : null}
        </div>
        {actions ? (
          <ActionGroup className="record-summary-actions" label={resolvedActionsLabel}>
            {actions}
          </ActionGroup>
        ) : null}
      </div>
      {items.length > 0 ? (
        <dl className="record-summary-grid">
          {items.map((item) => (
            <div className={getRecordSummaryItemClassName(item.tone)} key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children ? <div className="record-summary-extra">{children}</div> : null}
    </section>
  );
}

function getRecordSummaryItemClassName(tone: RecordSummaryTone | undefined) {
  return tone && tone !== "default" ? `record-summary-item record-summary-item-${tone}` : "record-summary-item";
}
