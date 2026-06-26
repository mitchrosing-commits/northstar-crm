import { customFieldDisplayValue, hasCustomFieldDisplayValue, isSupportedCustomFieldType } from "@/lib/custom-field-display";
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

export function CustomFieldSummaryCell({ fields }: { fields: CustomFieldListField[] }) {
  if (fields.length === 0) return <span className="muted">None configured</span>;

  const filledFields = fields.filter((field) => hasCustomFieldDisplayValue(field.value));
  if (filledFields.length === 0) return <span className="muted">None filled</span>;

  const previewFields = filledFields.slice(0, 2);
  const extraCount = filledFields.length - previewFields.length;

  return (
    <details className="custom-field-summary">
      <summary>
        {previewFields.map(summaryText).join(" · ")}
        {extraCount > 0 ? ` +${extraCount}` : ""}
      </summary>
      <dl className="custom-field-summary-list">
        {fields.map((field) => (
          <div className="custom-field-summary-item" key={field.id}>
            <dt>
              {field.name}
              {!isSupportedCustomFieldType(field.fieldType) ? <span className="badge">Read-only</span> : null}
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
  const supportedFields = fields.filter((field) => isSupportedCustomFieldType(field.fieldType));
  const selectedOperator = selectedCustomFieldOperator(params);

  if (supportedFields.length === 0) return null;

  return (
    <>
      <label className="form-field">
        <span>Custom field</span>
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
        <span>Custom operator</span>
        <select name="customFieldOperator" defaultValue={selectedOperator}>
          <option value="">Equals</option>
          <option value="contains">Contains text</option>
          <option value="is_empty">Is empty</option>
          <option value="is_not_empty">Is not empty</option>
        </select>
      </label>
      <label className="form-field">
        <span>Custom value</span>
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
  const readOnlySuffix = isSupportedCustomFieldType(field.fieldType) ? "" : " (read-only)";
  return `${field.name}: ${customFieldDisplayValue(field.value)}${readOnlySuffix}`;
}

function selectedCustomFieldOperator(params: ListSearchParams) {
  const operator = getSearchParam(params, "customFieldOperator");
  return operator === "contains" || operator === "is_empty" || operator === "is_not_empty" ? operator : "";
}
