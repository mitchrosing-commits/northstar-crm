"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatusBadge } from "@/components/status-badge";

type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED";

type QuoteStatusActionsProps = {
  canTransition?: boolean;
  id?: string;
  quoteId: string;
  quoteNumber?: string;
  status: QuoteStatus;
  workspaceId: string;
};

const nextActions: Record<QuoteStatus, Array<{ label: string; action: string }>> = {
  DRAFT: [{ label: "Mark sent", action: "mark-sent" }],
  SENT: [
    { label: "Mark accepted", action: "accept" },
    { label: "Mark declined", action: "decline" }
  ],
  ACCEPTED: [],
  DECLINED: []
};

export function QuoteStatusActions({
  canTransition = true,
  id,
  quoteId,
  quoteNumber = "quote",
  status,
  workspaceId
}: QuoteStatusActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const actions = nextActions[status] ?? [];
  const quoteStatusActionsLabel = `${quoteNumber} quote status actions`;

  async function transition(action: string) {
    setError(null);
    setNotice(null);
    if (savingAction !== null) return;
    setSavingAction(action);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quotes/${quoteId}/${action}`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not update this quote status.");
      setSavingAction(null);
      return;
    }

    setSavingAction(null);
    setNotice(statusActionNotice(action));
    preserveQuoteStatusAnchor();
    router.refresh();
  }

  return (
    <section className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={<StatusBadge status={status} />}
        description="Use these actions to track internal sales progress. Marking an accepted quote syncs the accepted total to the deal automatically when the deal value has not changed since send."
        title="Status and Actions"
      />
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {notice ? <FormSuccessMessage>{notice}</FormSuccessMessage> : null}
      {!canTransition ? (
        <LockedPanelNotice>Closed deals are locked. Quote status is read-only.</LockedPanelNotice>
      ) : actions.length > 0 ? (
        <ActionGroup className="filter-actions" label={quoteStatusActionsLabel}>
          {actions.map((item) => (
            <button
              aria-label={`${item.label} for ${quoteNumber}`}
              className={quoteStatusActionClassName(item.action)}
              disabled={savingAction !== null}
              key={item.action}
              onClick={() => transition(item.action)}
              title={`${item.label} for ${quoteNumber}`}
              type="button"
            >
              {savingAction === item.action ? "Saving..." : item.label}
            </button>
          ))}
        </ActionGroup>
      ) : (
        <EmptyState
          className="empty-state-compact empty-state-panel quote-status-terminal"
          title="No status actions available"
          description="Accepted and declined quotes are terminal in this MVP."
        />
      )}
    </section>
  );
}

function preserveQuoteStatusAnchor() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#quote-status`);
}

function quoteStatusActionClassName(action: string) {
  if (action === "accept") return "button-primary button-compact";
  if (action === "decline") return "button-danger button-compact";
  return "button-secondary button-compact";
}

function statusActionNotice(action: string) {
  if (action === "mark-sent") return "Quote marked sent. Public link actions are now available.";
  if (action === "accept") return "Quote marked accepted. Deal value sync was checked automatically.";
  if (action === "decline") return "Quote marked declined.";
  return "Quote status updated.";
}
