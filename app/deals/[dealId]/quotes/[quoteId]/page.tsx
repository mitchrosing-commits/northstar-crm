import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { QuoteReadinessPanel } from "@/components/commercial-workflow-panel";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { DownloadAction } from "@/components/download-action";
import { FormSuccessMessage } from "@/components/form-success-message";
import { formatDate, formatMoney, formatQuoteAdjustment } from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { QuoteAdjustmentsForm } from "@/components/quote-adjustments-form";
import { QuoteDealValueSyncAction } from "@/components/quote-deal-value-sync-action";
import { QuoteLifecycleHistoryPanel } from "@/components/quote-lifecycle-history-panel";
import { QuoteLineItemsPanel } from "@/components/quote-line-items-panel";
import { QuotePublicLinkControls } from "@/components/quote-public-link-controls";
import { RecordPanelJumpNav } from "@/components/record-panel-jump-nav";
import { QuoteStatusActions } from "@/components/quote-status-actions";
import { StatusBadge } from "@/components/status-badge";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { summarizeQuoteReadiness } from "@/lib/commercial-workflow";
import { formatPersonName } from "@/lib/person-name";
import { buildPublicQuoteUrl } from "@/lib/public-url";
import { buildQuoteFollowUpHref, quoteFollowUpStatus, quoteHasSimilarOpenFollowUp } from "@/lib/quote-follow-up";
import { getQuote, listProducts } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string; quoteId: string }>;
  searchParams?: Promise<{ created?: string; history?: string }>;
};

export default async function QuoteDetailPage({ params, searchParams }: PageProps) {
  const { dealId, quoteId } = await params;
  const query = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const quotePromise = getQuote(actor, dealId, quoteId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [quote, products] = await Promise.all([quotePromise, listProducts(actor)]);
  const publicLink = quote.publicLinks[0] ?? null;
  const publicUrl = publicLink ? buildPublicQuoteUrl(publicLink.token) : null;
  const readiness = summarizeQuoteReadiness({ quote, deal: quote.deal });
  const quoteFollowUpActionLabel = `Add follow-up for quote ${quote.number}`;
  const quotePrintActionLabel = `Open print view for quote ${quote.number}`;
  const quotePdfActionLabel = `Download PDF for quote ${quote.number}`;
  const backToDealActionLabel = `Back to deal ${quote.deal.title}`;
  const sentAt = findAuditEventDate(quote.auditLogs, "quote.sent");
  const acceptedAt = findAuditEventDate(quote.auditLogs, "quote.public_accepted") ?? findAuditEventDate(quote.auditLogs, "quote.accepted");
  const quoteHref = `/deals/${quote.dealId}/quotes/${quote.id}`;
  const quoteReturnHref = query?.history ? `${quoteHref}?history=${encodeURIComponent(query.history)}#quote-lifecycle` : `${quoteHref}#quote-lifecycle`;
  const quoteFollowUpHref = buildQuoteFollowUpHref(quote, {
    historyFilter: query?.history,
    returnHash: "quote-lifecycle"
  });
  const followUpStatus = quoteFollowUpStatus(quote);
  const hasSimilarOpenFollowUp = quoteHasSimilarOpenFollowUp(quote);
  const workflowSummary = buildQuoteWorkflowSummary({
    acceptedAt,
    followUpStatus,
    publicUrl,
    quote,
    quoteFollowUpHref,
    quoteReturnHref,
    sentAt
  });

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <>
            <StatusBadge status={quote.status} />
            {quote.status !== "DRAFT" ? (
              <Link
                aria-label={quoteFollowUpActionLabel}
                className="button-secondary"
                href={quoteFollowUpHref}
                title={quoteFollowUpActionLabel}
              >
                Create follow-up
              </Link>
            ) : null}
            <Link
              aria-label={quotePrintActionLabel}
              className="button-secondary"
              href={`/deals/${quote.dealId}/quotes/${quote.id}/print`}
              title={quotePrintActionLabel}
            >
              Print view
            </Link>
            <DownloadAction
              actionLabel={quotePdfActionLabel}
              className="button-secondary"
              filename={`quote-${quote.number}.pdf`}
              href={`/deals/${quote.dealId}/quotes/${quote.id}/pdf`}
              label="Download PDF"
              pendingLabel="Preparing PDF..."
            />
            <Link aria-label={backToDealActionLabel} className="button-secondary" href={`/deals/${quote.dealId}`} title={backToDealActionLabel}>
              Back to deal
            </Link>
          </>
        }
        eyebrow="Internal quote"
        subtitle="Review the deal context, line-item snapshot, totals, internal status, and public quote link from one scannable workspace view."
        title={quote.number}
      />

      <RecordPanelJumpNav
        ariaLabel={`${quote.number} quote sections`}
        jumps={[
          { href: "#quote-overview" as Route, label: "Overview" },
          { href: "#quote-context" as Route, label: "Context" },
          { href: "#quote-totals" as Route, label: "Totals" },
          { href: "#quote-readiness" as Route, label: "Readiness" },
          ...(quote.status === "DRAFT" && quote.deal.status === "OPEN"
            ? [{ href: "#quote-adjustments" as Route, label: "Adjustments" }]
            : []),
          { href: "#quote-status" as Route, label: "Actions" },
          { href: "#public-link" as Route, label: "Public link" },
          ...(quote.status === "ACCEPTED" ? [{ href: "#deal-value-sync" as Route, label: "Sync" }] : []),
          { href: "#quote-lifecycle" as Route, label: "History" },
          {
            href: "#quote-items" as Route,
            label: "Items",
            count: quote.items.length,
            countLabel: { singular: "line item", plural: "line items" }
          }
        ]}
        label="Quote sections"
      />
      {query?.created === "1" ? (
        <FormSuccessMessage>Quote draft created. Review the snapshot items, totals, and next status action.</FormSuccessMessage>
      ) : null}

      <section className="data-card quote-workflow-summary" id="quote-workflow-summary">
        <PanelTitleRow
          actions={<StatusBadge status={quote.status} />}
          description="A compact read on editability, sharing, accepted-quote sync, and the safest next step."
          title="Quote Workflow"
        />
        <dl className="quote-workflow-grid">
          {workflowSummary.map((item) => (
            <div className={`quote-workflow-item quote-workflow-item-${item.tone}`} key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
              <p>{item.help}</p>
              {item.href ? (
                <Link className="inline-link" href={item.href}>
                  {item.action}
                </Link>
              ) : null}
            </div>
          ))}
        </dl>
        <div className="quote-follow-up-actions">
          <Link className="button-secondary button-compact" href={quoteFollowUpHref}>
            Create reviewed follow-up draft
          </Link>
          <Link className="button-secondary button-compact" href={`/deals/${quote.dealId}#activities`}>
            Deal activities
          </Link>
          {followUpStatus.activity ? (
            <Link className="inline-link" href={`/activities/${followUpStatus.activity.id}/edit?returnTo=${encodeURIComponent(quoteReturnHref)}`}>
              Open related activity
            </Link>
          ) : null}
        </div>
        {hasSimilarOpenFollowUp ? (
          <p className="form-help">
            A similar open quote follow-up already exists. This link opens an editable draft; saving a second follow-up is still your choice.
          </p>
        ) : (
          <p className="form-help">
            Follow-up links open a suggested activity draft. Nothing is saved until you review and submit it.
          </p>
        )}
      </section>

      <section className="data-card quote-overview-summary" id="quote-overview">
        <PanelTitleRow
          actions={<StatusBadge status={quote.status} />}
          description="Internal quote snapshot for sales review. The customer-facing public view stays separate from this CRM workspace page."
          title="Quote Overview"
        />
        <dl className="quote-summary-grid">
          <div>
            <dt>Customer</dt>
            <dd>
              {quote.deal.organization?.name ??
                formatPersonName(quote.deal.person) ??
                "No customer linked"}
            </dd>
          </div>
          <div>
            <dt>Deal</dt>
            <dd>
              <Link className="inline-link" href={`/deals/${quote.dealId}`}>
                {quote.deal.title}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Line items</dt>
            <dd>{quote.items.length}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatMoney(quote.totalCents, quote.currency)}</dd>
          </div>
        </dl>
      </section>

      <section className="detail-grid quote-detail-overview" id="quote-context">
        <DetailFieldGrid
          fields={[
            {
              label: "Deal",
              value: (
                <Link className="inline-link" href={`/deals/${quote.dealId}`}>
                  {quote.deal.title}
                </Link>
              )
            },
            {
              emptyLabel: "No organization",
              label: "Organization",
              value: quote.deal.organization ? (
                <Link className="inline-link" href={`/organizations/${quote.deal.organization.id}`}>
                  {quote.deal.organization.name}
                </Link>
              ) : (
                null
              )
            },
            {
              emptyLabel: "No contact",
              label: "Contact",
              value: quote.deal.person ? (
                <Link className="inline-link" href={`/contacts/${quote.deal.person.id}`}>
                  {formatPersonName(quote.deal.person) ?? "Unnamed contact"}
                </Link>
              ) : (
                null
              )
            },
            { label: "Created", value: formatDate(quote.createdAt) }
          ]}
          title="Customer and Deal Context"
        />
      </section>

      <section className="detail-grid quote-detail-overview" id="quote-totals">
        <DetailFieldGrid
          fields={[
            { label: "Status", value: quote.status },
            { label: "Currency", value: quote.currency },
            { label: "Subtotal", value: formatMoney(quote.subtotalCents, quote.currency) },
            {
              label: "Quote-level discount",
              value: formatQuoteAdjustment(quote.discountType, quote.discountValue, quote.discountCents, quote.currency)
            },
            {
              label: "Quote-level tax",
              value: formatQuoteAdjustment(quote.taxType, quote.taxValue, quote.taxCents, quote.currency)
            },
            { label: "Total", value: formatMoney(quote.totalCents, quote.currency) }
          ]}
          title="Totals and Adjustments"
        />
      </section>

      <QuoteReadinessPanel id="quote-readiness" summary={readiness} />

      {quote.status === "DRAFT" && quote.deal.status === "OPEN" ? (
        <QuoteAdjustmentsForm
          discountType={quote.discountType}
          discountValue={quote.discountValue}
          id="quote-adjustments"
          quoteId={quote.id}
          taxType={quote.taxType}
          taxValue={quote.taxValue}
          workspaceId={workspace.id}
        />
      ) : null}

      <QuoteStatusActions
        canTransition={quote.deal.status === "OPEN"}
        id="quote-status"
        quoteId={quote.id}
        quoteNumber={quote.number}
        status={quote.status}
        workspaceId={workspace.id}
      />

      <QuotePublicLinkControls
        canGenerate={quote.status === "SENT" && quote.deal.status === "OPEN"}
        id="public-link"
        publicUrl={publicUrl}
        quoteId={quote.id}
        quoteNumber={quote.number}
        workspaceId={workspace.id}
      />

      {quote.status === "ACCEPTED" ? (
        <QuoteDealValueSyncAction
          dealCurrency={quote.deal.currency}
          dealValueSyncConflict={quote.dealValueSyncConflict}
          dealValueSyncResolution={quote.dealValueSyncResolution}
          dealValueSyncReviewedAt={quote.dealValueSyncReviewedAt}
          dealValueSyncedAt={quote.dealValueSyncedAt}
          dealValueCents={quote.deal.valueCents}
          dealId={quote.dealId}
          id="deal-value-sync"
          acceptedAt={acceptedAt}
          quoteCurrency={quote.currency}
          quoteHref={quoteHref}
          quoteId={quote.id}
          quoteTotalCents={quote.totalCents}
          sentAt={sentAt}
          sentDealCurrency={quote.sentDealCurrency}
          sentDealValueCents={quote.sentDealValueCents}
          workspaceId={workspace.id}
        />
      ) : null}

      <QuoteLifecycleHistoryPanel
        activeFilter={query?.history}
        dealId={quote.dealId}
        entries={quote.auditLogs}
        quote={quote}
        quoteState={{
          status: quote.status,
          dealStatus: quote.deal.status,
          totalCents: quote.totalCents,
          currency: quote.currency,
          publicLinkActive: Boolean(publicUrl),
          dealValueSyncedAt: quote.dealValueSyncedAt,
          dealValueSyncConflict: quote.dealValueSyncConflict,
          dealValueSyncReviewedAt: quote.dealValueSyncReviewedAt,
          dealValueSyncResolution: quote.dealValueSyncResolution,
          dealValueCents: quote.deal.valueCents,
          dealCurrency: quote.deal.currency
        }}
      />

      <QuoteLineItemsPanel
        canEdit={quote.status === "DRAFT" && quote.deal.status === "OPEN"}
        dealId={quote.dealId}
        items={quote.items}
        products={products}
        quoteCurrency={quote.currency}
        quoteId={quote.id}
        quoteNumber={quote.number}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}

function findAuditEventDate(
  events: Array<{ action: string; createdAt: Date | string }>,
  action: string
) {
  return events.find((event) => event.action === action)?.createdAt ?? null;
}

function buildQuoteWorkflowSummary({
  acceptedAt,
  followUpStatus,
  publicUrl,
  quote,
  quoteFollowUpHref,
  quoteReturnHref,
  sentAt
}: {
  acceptedAt: Date | string | null;
  followUpStatus: ReturnType<typeof quoteFollowUpStatus>;
  publicUrl: string | null;
  quote: Awaited<ReturnType<typeof getQuote>>;
  quoteFollowUpHref: Route;
  quoteReturnHref: string;
  sentAt: Date | string | null;
}) {
  const editable = quote.status === "DRAFT" && quote.deal.status === "OPEN";
  const syncStatus = quote.status !== "ACCEPTED"
    ? {
        action: undefined,
        help: "Deal-value sync is checked only after a quote is accepted.",
        href: undefined,
        label: "Deal sync",
        tone: "muted" as const,
        value: "Not applicable"
      }
    : quote.dealValueSyncedAt || (quote.deal.valueCents === quote.totalCents && quote.deal.currency === quote.currency)
      ? {
          action: "Review sync history",
          help: "The accepted quote total matches the deal value or was synced already.",
          href: "#deal-value-sync" as Route,
          label: "Deal sync",
          tone: "success" as const,
          value: "Synced"
        }
      : quote.dealValueSyncConflict && !quote.dealValueSyncReviewedAt
        ? {
            action: "Review conflict",
            help: "The deal value changed after send, so this needs human review.",
            href: "#deal-value-sync" as Route,
            label: "Deal sync",
            tone: "warning" as const,
            value: "Review needed"
          }
        : {
            action: "Review sync state",
            help: "The accepted quote sync state has been reviewed or is pending refresh.",
            href: "#deal-value-sync" as Route,
            label: "Deal sync",
            tone: "muted" as const,
            value: quote.dealValueSyncResolution === "KEEP_CURRENT_DEAL" ? "Current deal value kept" : "Pending"
          };

  return [
    {
      action: editable ? "Edit quote items" : "Review quote items",
      help: editable
        ? "Draft quote line items and adjustments can still be edited."
        : "Sent, accepted, and declined quotes preserve their pricing snapshot.",
      href: editable ? "#quote-items" as Route : "#quote-items" as Route,
      label: "Editability",
      tone: editable ? "success" as const : "muted" as const,
      value: editable ? "Editable draft" : "Snapshot locked"
    },
    {
      action: quote.status === "DRAFT" ? "Mark sent" : quote.status === "SENT" ? "Review status" : "Review lifecycle",
      help: quote.status === "DRAFT"
        ? "Mark sent when the draft is ready for customer sharing."
        : quote.status === "SENT"
          ? "Sent quotes can be accepted, declined, or shared by public link."
          : acceptedAt
            ? `Accepted on ${formatDate(acceptedAt)}.`
            : "This quote is in a terminal internal state.",
      href: "#quote-status" as Route,
      label: "Next action",
      tone: quote.status === "DRAFT" || quote.status === "SENT" ? "warning" as const : "muted" as const,
      value: quote.status === "DRAFT" ? "Prepare to send" : quote.status === "SENT" ? "Awaiting response" : "No status actions"
    },
    {
      action: quote.status === "SENT" ? "Manage public link" : undefined,
      help: publicUrl
        ? "A customer-facing public quote link is active."
        : quote.status === "SENT"
          ? "Generate a public link if the customer should review this quote outside the CRM."
          : sentAt
            ? "Public link actions are unavailable after terminal status."
            : "Mark sent before generating a public quote link.",
      href: quote.status === "SENT" ? "#public-link" as Route : undefined,
      label: "Public link",
      tone: publicUrl ? "success" as const : quote.status === "SENT" ? "warning" as const : "muted" as const,
      value: publicUrl ? "Active" : "Not shared"
    },
    {
      action: followUpStatus.activity ? "Open related activity" : "Create follow-up",
      help: followUpStatus.activity
        ? "Derived from existing deal activities that mention this quote."
        : "Open a suggested activity draft before saving any follow-up.",
      href: followUpStatus.activity
        ? `/activities/${followUpStatus.activity.id}/edit?returnTo=${encodeURIComponent(quoteReturnHref)}` as Route
        : quoteFollowUpHref,
      label: "Quote follow-up",
      tone: followUpStatus.tone,
      value: followUpStatus.label
    },
    syncStatus
  ];
}
