"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import { formatMoney } from "@/components/format";
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

type QuoteItem = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  lineTotalCents: number;
};

type QuoteLineItemsPanelProps = {
  canEdit: boolean;
  dealId: string;
  items: QuoteItem[];
  products: ProductOption[];
  quoteCurrency: string;
  quoteId: string;
  quoteNumber: string;
  workspaceId: string;
};

export function QuoteLineItemsPanel({
  canEdit,
  dealId,
  items,
  products,
  quoteCurrency,
  quoteId,
  quoteNumber,
  workspaceId
}: QuoteLineItemsPanelProps) {
  const router = useRouter();
  const currencyProducts = useMemo(() => products.filter((product) => product.currency === quoteCurrency), [products, quoteCurrency]);
  const [productId, setProductId] = useState(currencyProducts[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [description, setDescription] = useState("");
  const [rowDrafts, setRowDrafts] = useState(() => buildRowDrafts(items));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const selectedProduct = useMemo(() => currencyProducts.find((product) => product.id === productId), [productId, currencyProducts]);

  useEffect(() => {
    setRowDrafts(buildRowDrafts(items));
  }, [items]);

  useEffect(() => {
    if (!selectedProduct) setProductId(currencyProducts[0]?.id ?? "");
  }, [currencyProducts, selectedProduct]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (savingKey !== null) return;

    const parsedQuantity = Number(quantity);
    if (!canEdit) {
      setError("Only draft quotes on open deals can edit quote line items.");
      return;
    }
    if (!selectedProduct) {
      setError("Choose a product before adding a quote line item.");
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError("Quantity must be a whole number of at least 1.");
      return;
    }

    setSavingKey("add");
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quotes/${quoteId}/items`, {
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
      setError(body?.error?.message ?? "Could not add this quote line item.");
      setSavingKey(null);
      return;
    }

    setQuantity("1");
    setDescription("");
    setNotice("Quote item added. Draft totals refreshed.");
    setSavingKey(null);
    preserveQuoteItemsAnchor();
    router.refresh();
  }

  async function updateItem(item: QuoteItem) {
    setError(null);
    setNotice(null);
    if (savingKey !== null) return;
    if (!canEdit) {
      setError("Only draft quotes on open deals can edit quote line items.");
      return;
    }
    const draft = rowDrafts[item.id] ?? { quantity: String(item.quantity), description: item.description ?? "" };
    const parsedQuantity = Number(draft.quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError("Quantity must be a whole number of at least 1.");
      return;
    }

    setSavingKey(`update:${item.id}`);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quote-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quantity: parsedQuantity,
        description: draft.description.trim() || null
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not update this quote line item.");
      setSavingKey(null);
      return;
    }

    setNotice(`${item.name} saved. Draft totals refreshed.`);
    setSavingKey(null);
    preserveQuoteItemsAnchor();
    router.refresh();
  }

  async function removeItem(item: QuoteItem) {
    setError(null);
    setNotice(null);
    if (savingKey !== null) return;
    if (!canEdit) {
      setError("Only draft quotes on open deals can edit quote line items.");
      return;
    }

    setSavingKey(`remove:${item.id}`);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quote-items/${item.id}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not remove this quote line item.");
      setSavingKey(null);
      return;
    }

    setNotice(`${item.name} removed. Draft totals refreshed.`);
    setSavingKey(null);
    preserveQuoteItemsAnchor();
    router.refresh();
  }

  return (
    <section className="data-card section-spaced quote-items-panel" id="quote-items">
      <PanelTitleRow
        actions={<Badge>Snapshot pricing</Badge>}
        description="Draft quote item edits change this quote snapshot only. Deal line items and accepted quote pricing stay unchanged."
        title="Quote Items"
      />
      <p className="form-help">
        Return to{" "}
        <Link className="inline-link" href={`/deals/${dealId}#line-items`}>
          deal line items
        </Link>{" "}
        to change the source scope for future quotes.
      </p>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {notice ? <FormSuccessMessage compact>{notice}</FormSuccessMessage> : null}
      <TableScroll aria-label={`${quoteNumber} quote detail items table`}>
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
            {items.length > 0 ? (
              items.map((item) => {
                const draft = rowDrafts[item.id] ?? { quantity: String(item.quantity), description: item.description ?? "" };
                const rowSaving = savingKey?.endsWith(item.id) ?? false;

                return (
                  <tr key={item.id}>
                    <td data-label="Item">
                      <div className="table-primary-cell">
                        <strong>{item.name}</strong>
                        {canEdit ? (
                          <input
                            aria-label={`Description for ${item.name}`}
                            onChange={(event) => setRowDrafts((current) => ({
                              ...current,
                              [item.id]: { ...draft, description: event.target.value }
                            }))}
                            value={draft.description}
                          />
                        ) : item.description ? (
                          <span className="table-secondary-text">{item.description}</span>
                        ) : null}
                      </div>
                    </td>
                    <td data-label="Qty">
                      {canEdit ? (
                        <input
                          aria-label={`Quantity for ${item.name}`}
                          min="1"
                          onChange={(event) => setRowDrafts((current) => ({
                            ...current,
                            [item.id]: { ...draft, quantity: event.target.value }
                          }))}
                          step="1"
                          type="number"
                          value={draft.quantity}
                        />
                      ) : (
                        item.quantity
                      )}
                    </td>
                    <td data-label="Unit price">{formatMoney(item.unitPriceCents, item.currency)}</td>
                    <td data-label="Total">{formatMoney(item.lineTotalCents, item.currency)}</td>
                    <td className="table-actions-cell" data-label="Action">
                      {canEdit ? (
                        <>
                          <button
                            className="button-secondary button-compact"
                            disabled={savingKey !== null}
                            onClick={() => updateItem(item)}
                            type="button"
                          >
                            {savingKey === `update:${item.id}` ? "Saving..." : "Save"}
                          </button>
                          <button
                            className="button-danger button-compact"
                            disabled={savingKey !== null}
                            onClick={() => removeItem(item)}
                            type="button"
                          >
                            {savingKey === `remove:${item.id}` ? "Removing..." : "Remove"}
                          </button>
                        </>
                      ) : (
                        <Badge label={`Quote item ${item.name} is locked`}>Locked</Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} data-label="Quote items">
                  This draft quote has no line items. Add a product-backed quote item or return to the deal to update source line items for future quotes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
      {!canEdit ? (
        <LockedPanelNotice>Sent, accepted, and declined quotes preserve their line-item snapshot.</LockedPanelNotice>
      ) : currencyProducts.length > 0 ? (
        <form className="inline-form section-spaced" onSubmit={addItem}>
          <div className="form-grid">
            <label className="form-field">
              <FormFieldLabel required>Product</FormFieldLabel>
              <select onChange={(event) => setProductId(event.target.value)} value={productId}>
                {currencyProducts.map((product) => (
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
            disabledHint="Choose a product in this quote currency to continue."
            isSaving={savingKey === "add"}
            pendingLabel="Adding..."
            submitDisabled={!selectedProduct || savingKey !== null}
            submitLabel="Add quote item"
          />
        </form>
      ) : (
        <EmptyState
          actions={
            <Link className="button-secondary button-compact" href="/products">
              Open products
            </Link>
          }
          className="empty-state-compact empty-state-panel"
          description="Create or reactivate a product in this quote currency before adding line items to this draft quote."
          title="No matching active products"
        />
      )}
    </section>
  );
}

function preserveQuoteItemsAnchor() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#quote-items`);
}

function buildRowDrafts(items: QuoteItem[]) {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        quantity: String(item.quantity),
        description: item.description ?? ""
      }
    ])
  );
}
