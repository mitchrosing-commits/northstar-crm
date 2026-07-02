"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";

type CustomFieldDefinitionFormProps = {
  defaultEntityType?: EntityType;
  workspaceId: string;
};

type EntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";
type FieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";

const entityTypes = [
  ["DEAL", "Deal"],
  ["PERSON", "Contact"],
  ["ORGANIZATION", "Organization"],
  ["LEAD", "Lead"]
] as const;

const fieldTypes = [
  ["TEXT", "Text"],
  ["NUMBER", "Number"],
  ["DATE", "Date"],
  ["BOOLEAN", "Boolean"],
  ["SELECT", "Select"]
] as const;

export function CustomFieldDefinitionForm({ defaultEntityType = "DEAL", workspaceId }: CustomFieldDefinitionFormProps) {
  const router = useRouter();
  const [entityType, setEntityType] = useState<EntityType>(defaultEntityType);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [fieldType, setFieldType] = useState<FieldType>("TEXT");
  const [optionsText, setOptionsText] = useState("");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!keyEdited) setKey(slugKey(name));
  }, [keyEdited, name]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const safeKey = slugKey(key || name);
    if (!safeKey) {
      setError("Enter a field name that can generate a key.");
      return;
    }
    const selectOptions = fieldType === "SELECT" ? parseSelectOptions(optionsText) : undefined;
    if (fieldType === "SELECT" && selectOptions?.length === 0) {
      setError("Add at least one select option.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/custom-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType,
        name: name.trim(),
        key: safeKey,
        fieldType,
        options: selectOptions,
        required
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not create the custom field.");
      setIsSaving(false);
      return;
    }

    setName("");
    setKey("");
    setKeyEdited(false);
    setEntityType(defaultEntityType);
    setFieldType("TEXT");
    setOptionsText("");
    setRequired(false);
    setIsSaving(false);
    router.refresh();
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <div className="form-grid">
        <label className="form-field">
          <FormFieldLabel required>Applies to</FormFieldLabel>
          <select onChange={(event) => setEntityType(event.target.value as EntityType)} value={entityType}>
            {entityTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="muted">The field appears only on records of this type.</p>
        </label>
        <label className="form-field">
          <FormFieldLabel required>Label</FormFieldLabel>
          <input
            onChange={(event) => setName(event.target.value)}
            placeholder="Renewal priority"
            required
            value={name}
          />
        </label>
        <label className="form-field">
          <FormFieldLabel required>Key</FormFieldLabel>
          <input
            onChange={(event) => {
              setKeyEdited(true);
              setKey(slugKey(event.target.value));
            }}
            placeholder="renewal_priority"
            required
            value={key}
          />
        </label>
        <label className="form-field">
          <FormFieldLabel required>Type</FormFieldLabel>
          <select onChange={(event) => setFieldType(event.target.value as FieldType)} value={fieldType}>
            {fieldTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {fieldType === "SELECT" ? (
          <label className="form-field">
            <FormFieldLabel required>Options</FormFieldLabel>
            <textarea
              onChange={(event) => setOptionsText(event.target.value)}
              placeholder={"High\nMedium\nLow"}
              required
              rows={4}
              value={optionsText}
            />
            <p className="muted">Enter one option per line, or separate options with commas.</p>
          </label>
        ) : null}
        <label className="form-field checkbox-field">
          <input checked={required} onChange={(event) => setRequired(event.target.checked)} type="checkbox" />
          <span>Required</span>
        </label>
      </div>
      <FormActionBar
        disabledHint="Add a field label before creating this field."
        isSaving={isSaving}
        pendingLabel="Creating..."
        submitDisabled={!name.trim()}
        submitLabel="Create field"
      />
    </form>
  );
}

function slugKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]+/, "");
}

function parseSelectOptions(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((option) => option.trim())
        .filter(Boolean)
    )
  );
}
