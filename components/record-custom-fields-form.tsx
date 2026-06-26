"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type FieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT" | "URL";
type EntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";

type RecordCustomField = {
  id: string;
  name: string;
  key: string;
  fieldType: FieldType;
  required: boolean;
  options?: unknown;
  value: unknown;
};

type DealCustomFieldsFormProps = {
  dealId: string;
  fields: RecordCustomField[];
  workspaceId: string;
};

type RecordCustomFieldsFormProps = {
  emptyMessage: string;
  entityId: string;
  entityType: EntityType;
  fields: RecordCustomField[];
  workspaceId: string;
};

const editableTypes = new Set<FieldType>(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]);

export function DealCustomFieldsForm({ dealId, fields, workspaceId }: DealCustomFieldsFormProps) {
  return (
    <RecordCustomFieldsForm
      emptyMessage="No deal custom fields have been created yet."
      entityId={dealId}
      entityType="DEAL"
      fields={fields}
      workspaceId={workspaceId}
    />
  );
}

export function RecordCustomFieldsForm({
  emptyMessage,
  entityId,
  entityType,
  fields,
  workspaceId
}: RecordCustomFieldsFormProps) {
  const router = useRouter();
  const editableFields = fields.filter((field) => editableTypes.has(field.fieldType));
  const readOnlyFields = fields.filter((field) => !editableTypes.has(field.fieldType));
  const hasValues = fields.some((field) => hasDisplayValue(field.value));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editableFields.map((field) => [field.id, inputValue(field.value, field.fieldType)]))
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/custom-field-values`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType,
        entityId,
        values: Object.fromEntries(
          editableFields.map((field) => [field.id, normalizeFieldValue(field, values[field.id] ?? "")])
        )
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not save custom fields.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  if (fields.length === 0) {
    return <p className="empty-copy">{emptyMessage}</p>;
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {!hasValues ? <p className="empty-copy">Custom fields are ready, but no values have been filled in yet.</p> : null}
      {error ? <div className="form-error compact-error">{error}</div> : null}
      <div className="form-grid">
        {editableFields.map((field) => (
          <FieldInput
            field={field}
            key={field.id}
            onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            value={values[field.id] ?? ""}
          />
        ))}
        {readOnlyFields.map((field) => (
          <div className="form-field custom-field-readonly" key={field.id}>
            <span>{field.name}</span>
            <span className="badge">Read-only</span>
            <p className="field-value">{displayValue(field.value)}</p>
            <p className="muted">Only text, number, date, and yes/no fields can be edited in this MVP.</p>
          </div>
        ))}
      </div>
      {editableFields.length > 0 ? (
        <div className="form-actions">
          <button className="button-primary" disabled={isSaving} type="submit">
            {isSaving ? "Saving..." : "Save custom fields"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

export function RecordCustomFieldsReadOnly({
  emptyMessage,
  fields,
  lockedMessage
}: {
  emptyMessage: string;
  fields: RecordCustomField[];
  lockedMessage?: string;
}) {
  if (fields.length === 0) {
    return <p className="empty-copy">{emptyMessage}</p>;
  }
  const hasValues = fields.some((field) => hasDisplayValue(field.value));

  return (
    <div>
      {lockedMessage ? <p className="empty-copy">{lockedMessage}</p> : null}
      {!hasValues ? <p className="empty-copy">No custom field values have been filled in yet.</p> : null}
      <div className="form-grid">
        {fields.map((field) => (
          <div
            className={!editableTypes.has(field.fieldType) ? "form-field custom-field-readonly" : "form-field"}
            key={field.id}
          >
            <span>{field.name}</span>
            {!editableTypes.has(field.fieldType) ? <span className="badge">Read-only</span> : null}
            <p className="field-value">{displayValue(field.value)}</p>
            {!editableTypes.has(field.fieldType) ? (
              <p className="muted">Only text, number, date, and yes/no fields can be edited in this MVP.</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  onChange,
  value
}: {
  field: RecordCustomField;
  onChange: (value: string) => void;
  value: string;
}) {
  if (field.fieldType === "BOOLEAN") {
    return (
      <label className="form-field">
        <span>{field.name}</span>
        <select onChange={(event) => onChange(event.target.value)} required={field.required} value={value}>
          <option value="">Not set</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </label>
    );
  }

  if (field.fieldType === "SELECT") {
    const options = selectOptions(field.options);
    return (
      <label className="form-field">
        <span>{field.name}</span>
        <select onChange={(event) => onChange(event.target.value)} required={field.required} value={value}>
          <option value="">Not set</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="form-field">
      <span>{field.name}</span>
      <input
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        step={field.fieldType === "NUMBER" ? "any" : undefined}
        type={inputType(field.fieldType)}
        value={value}
      />
    </label>
  );
}

function inputType(fieldType: FieldType) {
  if (fieldType === "NUMBER") return "number";
  if (fieldType === "DATE") return "date";
  return "text";
}

function inputValue(value: unknown, fieldType: FieldType) {
  if (value === null || value === undefined) return "";
  if (fieldType === "BOOLEAN") return value === true ? "true" : value === false ? "false" : "";
  return String(value);
}

function normalizeFieldValue(field: RecordCustomField, value: string) {
  if (value === "") return null;
  if (field.fieldType === "NUMBER") return Number(value);
  if (field.fieldType === "BOOLEAN") return value === "true";
  return value;
}

function displayValue(value: unknown) {
  if (!hasDisplayValue(value)) return "Not filled in yet";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function hasDisplayValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function selectOptions(options: unknown) {
  return Array.isArray(options) ? options.filter((option): option is string => typeof option === "string") : [];
}
