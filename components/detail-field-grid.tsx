import { useId, type ReactNode } from "react";

import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { PanelTitleRow } from "@/components/panel-title-row";

type DetailField = {
  emptyLabel?: string;
  label: string;
  value?: ReactNode | null;
};

type DetailFieldGridProps = {
  fields: DetailField[];
  title?: string;
};

export function DetailFieldGrid({ fields, title = "Details" }: DetailFieldGridProps) {
  const titleId = `${useId()}-detail-field-grid-title`;

  return (
    <section aria-labelledby={titleId} className="data-card">
      <PanelTitleRow title={title} titleId={titleId} />
      <dl className="field-grid">
        {fields.map((field) => {
          const isEmpty = field.value === null || field.value === undefined || field.value === "";

          return (
            <div className="field-grid-item" key={field.label}>
              <dt className="field-label">{field.label}</dt>
              <dd className="field-value">
                {isEmpty ? (
                  <InlineEmptyStateText>{field.emptyLabel ?? "Not set"}</InlineEmptyStateText>
                ) : (
                  field.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
