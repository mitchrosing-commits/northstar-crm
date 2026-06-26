"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DealCloseActionsProps = {
  workspaceId: string;
  dealId: string;
  status: string;
};

export function DealCloseActions({ workspaceId, dealId, status }: DealCloseActionsProps) {
  const router = useRouter();
  const [lostReason, setLostReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<"WON" | "LOST" | "REOPEN" | null>(null);

  async function closeDeal(statusToSet: "WON" | "LOST") {
    setError(null);
    setIsSaving(statusToSet);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deals/${dealId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: statusToSet,
        lostReason: statusToSet === "LOST" ? lostReason.trim() || null : null
      })
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not close this deal.");
      setIsSaving(null);
      return;
    }

    setIsSaving(null);
    router.refresh();
  }

  async function reopenDeal() {
    if (!window.confirm("Reopen this deal?")) return;

    setError(null);
    setIsSaving("REOPEN");

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deals/${dealId}/reopen`, {
      method: "POST"
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not reopen this deal.");
      setIsSaving(null);
      return;
    }

    setIsSaving(null);
    router.refresh();
  }

  if (status !== "OPEN") {
    return (
      <div className="inline-form">
        {error ? <div className="form-error">{error}</div> : null}
        <p className="empty-copy">This deal is closed. Reopen it to edit the deal or move it between stages.</p>
        <div className="form-actions">
          <button className="button-primary" disabled={Boolean(isSaving)} onClick={reopenDeal} type="button">
            {isSaving === "REOPEN" ? "Reopening..." : "Reopen deal"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-form">
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-actions">
        <button className="button-primary" disabled={Boolean(isSaving)} onClick={() => closeDeal("WON")} type="button">
          {isSaving === "WON" ? "Marking won..." : "Mark won"}
        </button>
      </div>
      <label className="form-field">
        <span>Lost reason</span>
        <textarea onChange={(event) => setLostReason(event.target.value)} rows={3} value={lostReason} />
      </label>
      <div className="form-actions">
        <button className="button-secondary" disabled={Boolean(isSaving)} onClick={() => closeDeal("LOST")} type="button">
          {isSaving === "LOST" ? "Marking lost..." : "Mark lost"}
        </button>
      </div>
    </div>
  );
}
