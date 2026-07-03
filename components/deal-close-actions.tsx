"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { LockedPanelNotice } from "@/components/locked-panel-notice";

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
    const closedDealActionsLabel = "Closed deal actions";
    const reopenDealActionLabel = "Reopen deal for editing and stage movement";

    return (
      <div className="inline-form">
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
        <LockedPanelNotice title="Deal closed">
          This deal is closed. Reopen it to edit the deal or move it between stages.
        </LockedPanelNotice>
        <ActionGroup className="form-actions" label={closedDealActionsLabel}>
          <button
            aria-label={reopenDealActionLabel}
            className="button-primary button-compact"
            disabled={Boolean(isSaving)}
            onClick={reopenDeal}
            title={reopenDealActionLabel}
            type="button"
          >
            {isSaving === "REOPEN" ? "Reopening..." : "Reopen deal"}
          </button>
        </ActionGroup>
      </div>
    );
  }

  const markWonActionsLabel = "Mark deal won";
  const markLostActionsLabel = "Mark deal lost";
  const markWonActionLabel = "Mark deal as won";
  const markLostActionLabel = "Mark deal as lost";

  return (
    <div className="inline-form">
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <ActionGroup className="form-actions" label={markWonActionsLabel}>
        <button
          aria-label={markWonActionLabel}
          className="button-primary button-compact"
          disabled={Boolean(isSaving)}
          onClick={() => closeDeal("WON")}
          title={markWonActionLabel}
          type="button"
        >
          {isSaving === "WON" ? "Marking won..." : "Mark won"}
        </button>
      </ActionGroup>
      <label className="form-field">
        <FormFieldLabel>Lost reason</FormFieldLabel>
        <textarea onChange={(event) => setLostReason(event.target.value)} rows={3} value={lostReason} />
      </label>
      <ActionGroup className="form-actions" label={markLostActionsLabel}>
        <button
          aria-label={markLostActionLabel}
          className="button-danger button-compact"
          disabled={Boolean(isSaving)}
          onClick={() => closeDeal("LOST")}
          title={markLostActionLabel}
          type="button"
        >
          {isSaving === "LOST" ? "Marking lost..." : "Mark lost"}
        </button>
      </ActionGroup>
    </div>
  );
}
