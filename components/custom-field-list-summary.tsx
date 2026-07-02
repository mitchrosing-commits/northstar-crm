import { Badge } from "@/components/badge";
import { FormFieldLabel } from "@/components/form-field-label";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import {
  customFieldDisplayValue,
  hasCustomFieldDisplayValue,
  isEditableCustomFieldType,
  isFilterableCustomFieldType
} from "@/lib/custom-field-display";
import { getSearchParam, type ListSearchParams } from "@/lib/list-page-query";

type CustomFieldListField = {
  id: string;
  name: string;
  fieldType: string;
  value: unknown;
};

type CustomFieldDefinitionOption = {
  id: string;
  name: string;
  fieldType: string;
};

type CustomFieldSummaryCellProps = {
  emptyConfiguredLabel?: string;
  emptyFilledLabel?: string;
  fields: CustomFieldListField[];
};

export function CustomFieldSummaryCell({
  emptyConfiguredLabel = "None configured",
  emptyFilledLabel = "None filled",
  fields
}: CustomFieldSummaryCellProps) {
  if (fields.length === 0) return <InlineEmptyStateText>{emptyConfiguredLabel}</InlineEmptyStateText>;

  const filledFields = fields.filter((field) => hasCustomFieldDisplayValue(field.value));
  if (filledFields.length === 0) return <InlineEmptyStateText>{emptyFilledLabel}</InlineEmptyStateText>;

  const previewFields = filledFields.slice(0, 2);
  const extraCount = filledFields.length - previewFields.length;
  const previewSummary = `${previewFields.map(summaryText).join(" · ")}${extraCount > 0 ? ` +${extraCount}` : ""}`;
  const filledCountLabel = `${filledFields.length}/${fields.length} filled`;
  const summaryLabel = `Custom field summary: ${previewSummary}. ${filledFields.length} of ${fields.length} custom fields filled.`;

  return (
    <details aria-label={summaryLabel} className="custom-field-summary" title={summaryLabel}>
      <summary title={summaryLabel}>
        <span>{previewSummary}</span>
        <span className="custom-field-summary-count">{filledCountLabel}</span>
      </summary>
      <dl aria-label="Custom field values" className="custom-field-summary-list">
        {fields.map((field) => (
          <div className="custom-field-summary-item" key={field.id}>
            <dt>
              {field.name}
              {!isEditableCustomFieldType(field.fieldType) ? <Badge label={`${field.name} is read-only`}>Read-only</Badge> : null}
            </dt>
            <dd>{customFieldDisplayValue(field.value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function CustomFieldFilterControls({
  fields,
  params
}: {
  fields: CustomFieldDefinitionOption[];
  params: ListSearchParams;
}) {
  const supportedFields = fields.filter((field) => isFilterableCustomFieldType(field.fieldType));
  const selectedOperator = selectedCustomFieldOperator(params);

  if (supportedFields.length === 0) return null;

  return (
    <>
      <label className="form-field">
        <FormFieldLabel>Custom field</FormFieldLabel>
        <select name="customFieldId" defaultValue={getSearchParam(params, "customFieldId")}>
          <option value="">Any custom field</option>
          {supportedFields.map((field) => (
            <option value={field.id} key={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <FormFieldLabel>Custom operator</FormFieldLabel>
        <select name="customFieldOperator" defaultValue={selectedOperator}>
          <option value="">Equals</option>
          <option value="contains">Contains text</option>
          <option value="is_empty">Is empty</option>
          <option value="is_not_empty">Is not empty</option>
        </select>
      </label>
      <label className="form-field">
        <FormFieldLabel>Custom value</FormFieldLabel>
        <input
          name="customFieldValue"
          placeholder="Value"
          defaultValue={getSearchParam(params, "customFieldValue")}
        />
        <small className="form-hint">
          Filters one supported custom field. Contains is text-only; empty checks ignore this value.
        </small>
      </label>
    </>
  );
}

function summaryText(field: CustomFieldListField) {
  const readOnlySuffix = isEditableCustomFieldType(field.fieldType) ? "" : " (read-only)";
  return `${field.name}: ${customFieldDisplayValue(field.value)}${readOnlySuffix}`;
}

function selectedCustomFieldOperator(params: ListSearchParams) {
  const operator = getSearchParam(params, "customFieldOperator");
  return operator === "contains" || operator === "is_empty" || operator === "is_not_empty" ? operator : "";
}
