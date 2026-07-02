"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { LockedPanelNotice } from "@/components/locked-panel-notice";

export type RecordCustomFieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT" | "URL";
export type RecordCustomFieldEntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";

export type RecordCustomField = {
  id: string;
  name: string;
  key: string;
  fieldType: RecordCustomFieldType;
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
  entityType: RecordCustomFieldEntityType;
  fields: RecordCustomField[];
  workspaceId: string;
};

const editableTypes = new Set<RecordCustomFieldType>(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]);
const readOnlyCustomFieldMessage = "Only text, number, date, yes/no, and single-select fields can be edited in this MVP.";

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
    return <CustomFieldsEmptyState title={emptyMessage} />;
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {!hasValues ? <CustomFieldsEmptyState title="Custom fields are ready, but no values have been filled in yet." /> : null}
      {error ? <FormErrorMessage compact>{error}</FormErrorMessage> : null}
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
            <FormFieldLabel required={field.required}>{field.name}</FormFieldLabel>
            <Badge label={`${field.name} is read-only`}>Read-only</Badge>
            <p className="field-value">{displayValue(field.value)}</p>
            <CustomFieldReadOnlyNotice />
          </div>
        ))}
      </div>
      {editableFields.length > 0 ? <FormActionBar isSaving={isSaving} submitLabel="Save custom fields" /> : null}
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
    return <CustomFieldsEmptyState title={emptyMessage} />;
  }
  const hasValues = fields.some((field) => hasDisplayValue(field.value));

  return (
    <div>
      {lockedMessage ? <LockedPanelNotice>{lockedMessage}</LockedPanelNotice> : null}
      {!hasValues ? <CustomFieldsEmptyState title="No custom field values have been filled in yet." /> : null}
      <div className="form-grid">
        {fields.map((field) => (
          <div
            className={!editableTypes.has(field.fieldType) ? "form-field custom-field-readonly" : "form-field"}
            key={field.id}
          >
            <FormFieldLabel required={field.required}>{field.name}</FormFieldLabel>
            {!editableTypes.has(field.fieldType) ? <Badge label={`${field.name} is read-only`}>Read-only</Badge> : null}
            <p className="field-value">{displayValue(field.value)}</p>
            {!editableTypes.has(field.fieldType) ? <CustomFieldReadOnlyNotice /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomFieldsEmptyState({ title }: { title: string }) {
  return <EmptyState className="empty-state-compact empty-state-panel record-custom-fields-empty" title={title} />;
}

function CustomFieldReadOnlyNotice() {
  return <p className="custom-field-readonly-note">{readOnlyCustomFieldMessage}</p>;
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
        <FormFieldLabel required={field.required}>{field.name}</FormFieldLabel>
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
        <FormFieldLabel required={field.required}>{field.name}</FormFieldLabel>
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
      <FormFieldLabel required={field.required}>{field.name}</FormFieldLabel>
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

function inputType(fieldType: RecordCustomFieldType) {
  if (fieldType === "NUMBER") return "number";
  if (fieldType === "DATE") return "date";
  return "text";
}

function inputValue(value: unknown, fieldType: RecordCustomFieldType) {
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
