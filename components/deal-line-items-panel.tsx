"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { formatMoney } from "@/components/format";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";

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
  canEdit?: boolean;
};

export function DealLineItemsPanel({
  workspaceId,
  dealId,
  products,
  lineItems,
  canEdit = true
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

    if (!canEdit) {
      setError("Closed deals are locked. Line items are read-only.");
      return;
    }

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
    if (!canEdit) {
      setError("Closed deals are locked. Line items are read-only.");
      return;
    }
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
    <section className="data-card section-spaced" id="line-items">
      <PanelTitleRow
        actions={<Badge label={`Line item total: ${totalLabel}`}>{totalLabel}</Badge>}
        description="Line items start from active Products: the products, services, or packages your company sells. They seed draft quotes, while accepted quote totals update deal value automatically when the deal has not changed since send."
        title="Line Items"
      />
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <TableScroll aria-label="Deal line items table">
        <table className="table crm-list-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Total</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length > 0 ? (
              lineItems.map((lineItem) => {
                const removeLineItemLabel = `Remove line item ${lineItem.productName}`;

                return (
                  <tr key={lineItem.id}>
                    <td data-label="Item">
                      <div className="table-primary-cell">
                        <strong>{lineItem.productName}</strong>
                        {lineItem.description ? <span className="table-secondary-text">{lineItem.description}</span> : null}
                      </div>
                    </td>
                    <td data-label="Qty">{lineItem.quantity}</td>
                    <td data-label="Unit price">
                      {formatMoney(lineItem.unitPriceCents, lineItem.currency)}
                    </td>
                    <td data-label="Total">
                      {formatMoney(lineItem.lineTotalCents, lineItem.currency)}
                    </td>
                    <td className="table-actions-cell" data-label="Action">
                      {canEdit ? (
                        <button
                          aria-label={removeLineItemLabel}
                          className="button-secondary button-compact"
                          disabled={removingId === lineItem.id}
                          onClick={() => removeLineItem(lineItem.id)}
                          title={removeLineItemLabel}
                          type="button"
                        >
                          {removingId === lineItem.id ? "Removing..." : "Remove"}
                        </button>
                      ) : (
                        <Badge label={`Line item ${lineItem.productName} is locked`}>Locked</Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} data-label="Line items">
                  <InlineEmptyStateText>No line items yet. Add products, services, or packages to define the deal scope before creating a quote draft.</InlineEmptyStateText>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
      {!canEdit ? (
        <LockedPanelNotice>Closed deals are locked. Line items are read-only.</LockedPanelNotice>
      ) : products.length > 0 ? (
        <form className="inline-form section-spaced" onSubmit={onSubmit}>
          <div className="form-grid">
            <label className="form-field">
              <FormFieldLabel required>Product</FormFieldLabel>
              <select onChange={(event) => setProductId(event.target.value)} value={productId}>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {formatMoney(product.unitPriceCents, product.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <FormFieldLabel required>Quantity</FormFieldLabel>
              <input min="1" onChange={(event) => setQuantity(event.target.value)} step="1" type="number" value={quantity} />
            </label>
            <label className="form-field form-field-wide">
              <FormFieldLabel>Description override</FormFieldLabel>
              <input onChange={(event) => setDescription(event.target.value)} value={description} />
            </label>
          </div>
          <FormActionBar
            isSaving={isSaving}
            pendingLabel="Adding..."
            submitDisabled={!selectedProduct}
            submitLabel="Add line item"
          />
        </form>
      ) : (
        <EmptyState
          actions={
            <Link className="button-secondary button-compact" href="/products">
              Open products
            </Link>
          }
          className="empty-state-compact empty-state-panel deal-line-items-empty"
          title="No active products available"
          description="Create or reactivate a product, service, or package before adding line items to this deal."
        />
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
