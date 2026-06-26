"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED";

type QuoteStatusActionsProps = {
  workspaceId: string;
  quoteId: string;
  status: QuoteStatus;
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

export function QuoteStatusActions({ workspaceId, quoteId, status }: QuoteStatusActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const actions = nextActions[status] ?? [];

  async function transition(action: string) {
    setError(null);
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
    router.refresh();
  }

  return (
    <section className="data-card" style={{ marginTop: 14 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Internal Status</h2>
        <span className="badge">{status}</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 14 }}>
        These actions track internal sales progress only. They do not send email, expose a public link, or collect customer acceptance.
      </p>
      {error ? <div className="form-error">{error}</div> : null}
      {actions.length > 0 ? (
        <div className="filter-actions">
          {actions.map((item) => (
            <button
              className="button-secondary button-compact"
              disabled={savingAction !== null}
              key={item.action}
              onClick={() => transition(item.action)}
              type="button"
            >
              {savingAction === item.action ? "Saving..." : item.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-copy">Accepted and declined quotes are terminal in this MVP.</p>
      )}
    </section>
  );
}
