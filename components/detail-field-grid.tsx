import type { ReactNode } from "react";

type DetailField = {
  label: string;
  value: ReactNode;
};

type DetailFieldGridProps = {
  fields: DetailField[];
  title?: string;
};

export function DetailFieldGrid({ fields, title = "Details" }: DetailFieldGridProps) {
  return (
    <div className="data-card">
      <h2 className="panel-title">{title}</h2>
      <dl className="field-grid">
        {fields.map((field) => (
          <div key={field.label}>
            <dt className="field-label">{field.label}</dt>
            <dd className="field-value">{field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
