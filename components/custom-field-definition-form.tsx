"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type CustomFieldDefinitionFormProps = {
  defaultEntityType?: EntityType;
  workspaceId: string;
};

type EntityType = "DEAL" | "PERSON" | "ORGANIZATION" | "LEAD";

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
  ["BOOLEAN", "Boolean"]
] as const;

export function CustomFieldDefinitionForm({ defaultEntityType = "DEAL", workspaceId }: CustomFieldDefinitionFormProps) {
  const router = useRouter();
  const [entityType, setEntityType] = useState<EntityType>(defaultEntityType);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [fieldType, setFieldType] = useState<(typeof fieldTypes)[number][0]>("TEXT");
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

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/custom-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType,
        name: name.trim(),
        key: safeKey,
        fieldType,
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
    setRequired(false);
    setIsSaving(false);
    router.refresh();
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid">
        <label className="form-field">
          <span>Applies to</span>
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
          <span>Label</span>
          <input
            onChange={(event) => setName(event.target.value)}
            placeholder="Renewal priority"
            required
            value={name}
          />
        </label>
        <label className="form-field">
          <span>Key</span>
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
          <span>Type</span>
          <select onChange={(event) => setFieldType(event.target.value as typeof fieldType)} value={fieldType}>
            {fieldTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field checkbox-field">
          <input checked={required} onChange={(event) => setRequired(event.target.checked)} type="checkbox" />
          <span>Required</span>
        </label>
      </div>
      <div className="form-actions">
        <button className="button-primary" disabled={isSaving || !name.trim()} type="submit">
          {isSaving ? "Creating..." : "Create field"}
        </button>
      </div>
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
