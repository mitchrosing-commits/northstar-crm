"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";

type ProductCreateFormProps = {
  workspaceId: string;
  mode?: "create" | "edit";
  variant?: "card" | "compact";
  initialProduct?: {
    id: string;
    name: string;
    description: string | null;
    unitPriceCents: number;
    currency: string;
  };
};

export function ProductCreateForm({ workspaceId, mode = "create", variant = "card", initialProduct }: ProductCreateFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialProduct?.name ?? "");
  const [description, setDescription] = useState(initialProduct?.description ?? "");
  const [unitPrice, setUnitPrice] = useState(
    initialProduct ? formatCentsInput(initialProduct.unitPriceCents) : ""
  );
  const [currency, setCurrency] = useState(initialProduct?.currency ?? "USD");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const unitPriceCents = parseMoneyToCents(unitPrice);
    if (unitPriceCents === "INVALID") {
      setError("Enter a valid non-negative unit price.");
      return;
    }

    setIsSaving(true);
    const endpoint =
      mode === "create"
        ? `/api/v1/workspaces/${workspaceId}/products`
        : `/api/v1/workspaces/${workspaceId}/products/${initialProduct?.id}`;
    const response = await fetch(endpoint, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        unitPriceCents,
        currency: currency.trim().toUpperCase()
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? (mode === "create" ? "Could not create this product." : "Could not save this product."));
      setIsSaving(false);
      return;
    }

    if (mode === "create") {
      setName("");
      setDescription("");
      setUnitPrice("");
      setCurrency("USD");
    }
    setIsSaving(false);
    router.refresh();
  }

  return (
    <form className={variant === "compact" ? "inline-form product-edit-form" : "form-card"} onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <div className="form-grid">
        <label className="form-field">
          <FormFieldLabel required>Name</FormFieldLabel>
          <input onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label className="form-field">
          <FormFieldLabel required>Unit price</FormFieldLabel>
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => setUnitPrice(event.target.value)}
            placeholder="0"
            required
            step="0.01"
            type="number"
            value={unitPrice}
          />
        </label>
        <label className="form-field">
          <FormFieldLabel required>Currency</FormFieldLabel>
          <input
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            pattern="[A-Z]{3}"
            required
            value={currency}
          />
        </label>
        <label className="form-field">
          <FormFieldLabel>Description</FormFieldLabel>
          <input onChange={(event) => setDescription(event.target.value)} value={description} />
        </label>
      </div>
      <FormActionBar
        compact={variant === "compact"}
        disabledHint="Add a product name and unit price before saving."
        isSaving={isSaving}
        submitDisabled={!name.trim() || !unitPrice.trim()}
        submitLabel={mode === "create" ? "Create product" : "Save product"}
      />
    </form>
  );
}

function parseMoneyToCents(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "INVALID";
  return Math.round(parsed * 100);
}

function formatCentsInput(valueCents: number) {
  return valueCents % 100 === 0 ? String(valueCents / 100) : (valueCents / 100).toFixed(2);
}
