"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Badge } from "@/components/badge";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { PanelTitleRow } from "@/components/panel-title-row";

type AdjustmentType = "NONE" | "PERCENT" | "FIXED";

type QuoteAdjustmentsFormProps = {
  discountType: AdjustmentType;
  discountValue: number;
  id?: string;
  quoteId: string;
  taxType: AdjustmentType;
  taxValue: number;
  workspaceId: string;
};

export function QuoteAdjustmentsForm({
  discountType: initialDiscountType,
  discountValue: initialDiscountValue,
  id,
  quoteId,
  taxType: initialTaxType,
  taxValue: initialTaxValue,
  workspaceId
}: QuoteAdjustmentsFormProps) {
  const router = useRouter();
  const [discountType, setDiscountType] = useState<AdjustmentType>(initialDiscountType);
  const [discountValue, setDiscountValue] = useState(formatAdjustmentInput(initialDiscountType, initialDiscountValue));
  const [taxType, setTaxType] = useState<AdjustmentType>(initialTaxType);
  const [taxValue, setTaxValue] = useState(formatAdjustmentInput(initialTaxType, initialTaxValue));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedDiscountValue = parseAdjustmentInput(discountType, discountValue);
    const parsedTaxValue = parseAdjustmentInput(taxType, taxValue);
    if (parsedDiscountValue === "INVALID" || parsedTaxValue === "INVALID") {
      setError("Enter non-negative adjustment values. Percent values cannot exceed 100.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quotes/${quoteId}/adjustments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discountType,
        discountValue: parsedDiscountValue,
        taxType,
        taxValue: parsedTaxValue
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not update quote adjustments.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  return (
    <section className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={<Badge label="Quote adjustments are available for draft quotes only">Draft only</Badge>}
        description="Apply one quote-level discount and one quote-level tax while this quote is DRAFT. Percent tax is calculated after discount. Line item snapshots stay unchanged."
        title="Quote Adjustments"
      />
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <form className="inline-form" onSubmit={onSubmit}>
        <div className="form-grid">
          <AdjustmentFields
            label="Discount"
            onTypeChange={(value) => {
              setDiscountType(value);
              setDiscountValue("");
            }}
            onValueChange={setDiscountValue}
            type={discountType}
            value={discountValue}
          />
          <AdjustmentFields
            label="Tax"
            onTypeChange={(value) => {
              setTaxType(value);
              setTaxValue("");
            }}
            onValueChange={setTaxValue}
            type={taxType}
            value={taxValue}
          />
        </div>
        <FormActionBar isSaving={isSaving} submitLabel="Save adjustments" />
      </form>
    </section>
  );
}

function AdjustmentFields({
  label,
  type,
  value,
  onTypeChange,
  onValueChange
}: {
  label: string;
  type: AdjustmentType;
  value: string;
  onTypeChange: (type: AdjustmentType) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <>
      <label className="form-field">
        <FormFieldLabel>{label} type</FormFieldLabel>
        <select onChange={(event) => onTypeChange(event.target.value as AdjustmentType)} value={type}>
          <option value="NONE">None</option>
          <option value="PERCENT">Percent</option>
          <option value="FIXED">Fixed amount</option>
        </select>
      </label>
      <label className="form-field">
        <FormFieldLabel>{label} value</FormFieldLabel>
        <input
          disabled={type === "NONE"}
          inputMode="decimal"
          min="0"
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={type === "PERCENT" ? "10" : "0"}
          step="0.01"
          type="number"
          value={type === "NONE" ? "" : value}
        />
      </label>
    </>
  );
}

function parseAdjustmentInput(type: AdjustmentType, value: string) {
  if (type === "NONE") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (type === "PERCENT" && parsed > 100)) return "INVALID";
  return Math.round(parsed * 100);
}

function formatAdjustmentInput(type: AdjustmentType, value: number) {
  if (type === "NONE" || value === 0) return "";
  const displayValue = type === "PERCENT" ? value / 100 : value / 100;
  return displayValue % 1 === 0 ? String(displayValue) : displayValue.toFixed(2);
}
