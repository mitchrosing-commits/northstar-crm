"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import { formatMoney } from "@/components/format";
import { PanelTitleRow } from "@/components/panel-title-row";
import { formatPersonName } from "@/lib/person-name";

type QuoteCreationDeal = {
  id: string;
  title: string;
  status: string;
  valueCents: number | null;
  currency: string;
  person: {
    firstName: string;
    lastName: string | null;
    email: string | null;
  } | null;
  organization: { name: string } | null;
  quotes: Array<{ number: string; status: string }>;
  _count: { lineItems: number; quotes: number };
};

type QuoteCreateFromDealPanelProps = {
  dealQuery: string;
  deals: QuoteCreationDeal[];
  workspaceId: string;
};

export function QuoteCreateFromDealPanel({ dealQuery, deals, workspaceId }: QuoteCreateFromDealPanelProps) {
  const router = useRouter();
  const eligibleDeals = useMemo(
    () => deals.filter((deal) => deal.status === "OPEN" && deal._count.lineItems > 0),
    [deals]
  );
  const [selectedDealId, setSelectedDealId] = useState(eligibleDeals[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const selectedDeal = deals.find((deal) => deal.id === selectedDealId) ?? null;

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (isSaving) return;

    if (!selectedDeal) {
      setError("Choose an open deal with line items before creating a quote.");
      return;
    }
    if (selectedDeal._count.lineItems === 0) {
      setError("Add at least one deal line item before creating a quote.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deals/${selectedDeal.id}/quotes`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not create this quote.");
      setIsSaving(false);
      return;
    }

    const quote = await response.json();
    setNotice("Quote created. Opening the draft now.");
    router.push(`/deals/${quote.dealId}/quotes/${quote.id}?created=1#quote-items`);
  }

  return (
    <section className="panel section-separated" id="create-quote">
      <PanelTitleRow
        actions={<Badge>{eligibleDeals.length} ready</Badge>}
        description="Create a draft quote from an existing open deal. Quotes remain associated with deals and copy the current deal line items into an editable draft snapshot."
        title="Create Quote"
      />
      <form action="/quotes" className="inline-form">
        <div className="form-grid">
          <label className="form-field form-field-wide">
            <FormFieldLabel>Find deal</FormFieldLabel>
            <input defaultValue={dealQuery} name="dealQ" placeholder="Search open deals by title, contact, or organization" />
          </label>
        </div>
        <FormActionBar isSaving={false} submitLabel="Search deals" />
      </form>
      {deals.length > 0 ? (
        <form className="inline-form section-spaced" onSubmit={createQuote}>
          <div className="form-grid">
            <label className="form-field form-field-wide">
              <FormFieldLabel required>Deal</FormFieldLabel>
              <select onChange={(event) => setSelectedDealId(event.target.value)} value={selectedDealId}>
                {deals.map((deal) => (
                  <option disabled={deal.status !== "OPEN" || deal._count.lineItems === 0} key={deal.id} value={deal.id}>
                    {deal.title} · {deal._count.lineItems} line items · {formatMoney(deal.valueCents, deal.currency)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedDeal ? (
            <p className="form-help">
              {selectedDeal.organization?.name ?? formatPersonName(selectedDeal.person) ?? "No customer linked"} ·{" "}
              {selectedDeal._count.quotes} existing quotes
              {selectedDeal.quotes[0] ? ` · latest ${selectedDeal.quotes[0].number} ${selectedDeal.quotes[0].status}` : ""}
            </p>
          ) : null}
          {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
          {notice ? <FormSuccessMessage>{notice}</FormSuccessMessage> : null}
          <FormActionBar
            isSaving={isSaving}
            pendingLabel="Creating..."
            submitDisabled={!selectedDealId}
            submitLabel="Create quote draft"
          />
        </form>
      ) : (
        <EmptyState
          actions={
            <Link className="button-secondary button-compact" href="/deals">
              Open deals
            </Link>
          }
          className="empty-state-compact empty-state-panel"
          description="No open deals matched this search. Create or open a deal, add line items, then create the quote from here or from the deal page."
          title="No selectable deals"
        />
      )}
    </section>
  );
}
