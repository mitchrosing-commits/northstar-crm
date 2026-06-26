"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { formatMoney } from "@/components/format";

type ProductOption = {
  id: string;
  name: string;
  description: string | null;
  unitPriceCents: number;
  currency: string;
};

type DealLineItem = {
  id: string;
  productName: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  lineTotalCents: number;
};

type DealLineItemsPanelProps = {
  workspaceId: string;
  dealId: string;
  products: ProductOption[];
  lineItems: DealLineItem[];
};

export function DealLineItemsPanel({
  workspaceId,
  dealId,
  products,
  lineItems
}: DealLineItemsPanelProps) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const selectedProduct = useMemo(() => products.find((product) => product.id === productId), [productId, products]);
  const totalLabel = formatLineItemTotals(lineItems);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedQuantity = Number(quantity);
    if (!selectedProduct) {
      setError("Choose a product before adding a line item.");
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError("Quantity must be a whole number of at least 1.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deals/${dealId}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: selectedProduct.id,
        quantity: parsedQuantity,
        description: description.trim() || null
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not add this line item.");
      setIsSaving(false);
      return;
    }

    setQuantity("1");
    setDescription("");
    setIsSaving(false);
    router.refresh();
  }

  async function removeLineItem(lineItemId: string) {
    setError(null);
    setRemovingId(lineItemId);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deal-line-items/${lineItemId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not remove this line item.");
      setRemovingId(null);
      return;
    }

    setRemovingId(null);
    router.refresh();
  }

  return (
    <section className="data-card" style={{ marginTop: 14 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Line Items</h2>
        <span className="badge">{totalLabel}</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 14 }}>
        Line items snapshot active product pricing when added. They stay separate from deal value, reporting totals, and Forecasting v1 until an accepted quote is manually synced.
      </p>
      {error ? <div className="form-error">{error}</div> : null}
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit price</th>
            <th>Total</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.length > 0 ? (
            lineItems.map((lineItem) => (
              <tr key={lineItem.id}>
                <td>
                  <strong>{lineItem.productName}</strong>
                </td>
                <td>{lineItem.description ?? ""}</td>
                <td>{lineItem.quantity}</td>
                <td>{formatMoney(lineItem.unitPriceCents, lineItem.currency)}</td>
                <td>{formatMoney(lineItem.lineTotalCents, lineItem.currency)}</td>
                <td>
                  <button
                    className="button-secondary button-compact"
                    disabled={removingId === lineItem.id}
                    onClick={() => removeLineItem(lineItem.id)}
                    type="button"
                  >
                    {removingId === lineItem.id ? "Removing..." : "Remove"}
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>No line items have been added.</td>
            </tr>
          )}
        </tbody>
      </table>
      {products.length > 0 ? (
        <form className="inline-form" onSubmit={onSubmit} style={{ marginTop: 16 }}>
          <div className="form-grid">
            <label className="form-field">
              <span>Product</span>
              <select onChange={(event) => setProductId(event.target.value)} value={productId}>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {formatMoney(product.unitPriceCents, product.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Quantity</span>
              <input min="1" onChange={(event) => setQuantity(event.target.value)} step="1" type="number" value={quantity} />
            </label>
            <label className="form-field form-field-wide">
              <span>Description override</span>
              <input onChange={(event) => setDescription(event.target.value)} value={description} />
            </label>
          </div>
          <div className="form-actions">
            <button className="button-primary" disabled={isSaving || !selectedProduct} type="submit">
              {isSaving ? "Adding..." : "Add line item"}
            </button>
          </div>
        </form>
      ) : (
        <p className="empty-copy" style={{ marginTop: 14 }}>
          Create or reactivate a product before adding line items to this deal.
        </p>
      )}
    </section>
  );
}

function formatLineItemTotals(lineItems: DealLineItem[]) {
  if (lineItems.length === 0) return "Line item total: $0";

  const totalsByCurrency = new Map<string, number>();
  for (const lineItem of lineItems) {
    totalsByCurrency.set(lineItem.currency, (totalsByCurrency.get(lineItem.currency) ?? 0) + lineItem.lineTotalCents);
  }

  return [...totalsByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => `Line item total: ${formatMoney(total, currency)}`)
    .join(" · ");
}
