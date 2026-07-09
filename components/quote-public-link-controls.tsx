"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { PanelTitleRow } from "@/components/panel-title-row";

type QuotePublicLinkControlsProps = {
  canGenerate: boolean;
  id?: string;
  publicUrl: string | null;
  quoteId: string;
  quoteNumber?: string;
  workspaceId: string;
};

export function QuotePublicLinkControls({
  canGenerate,
  id,
  publicUrl,
  quoteId,
  quoteNumber = "quote",
  workspaceId
}: QuotePublicLinkControlsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const publicLinkActionsLabel = `${quoteNumber} public quote link actions`;
  const publicLinkStatus = publicUrl ? "Active" : "Not shared";

  async function generateLink() {
    setError(null);
    setNotice(null);
    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quotes/${quoteId}/public-link`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not create this public quote link.");
      setIsSaving(false);
      return;
    }

    setNotice("Public quote link is active.");
    setIsSaving(false);
    router.refresh();
  }

  async function revokeLink() {
    setError(null);
    setNotice(null);
    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quotes/${quoteId}/public-link`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not revoke this public quote link.");
      setIsSaving(false);
      return;
    }

    setNotice("Public quote link was revoked.");
    setIsSaving(false);
    router.refresh();
  }

  async function copyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setNotice("Public quote link copied.");
  }

  return (
    <section className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={<Badge label={`Public quote link status: ${publicLinkStatus}`}>{publicLinkStatus}</Badge>}
        description="Public links are customer-facing quote views with optional acceptance while the quote is sent. Revoking a link immediately makes it return a safe 404. Links do not expose the CRM app, send email, capture signatures, or allow payment."
        title="Public Quote Link"
      />
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {notice ? (
        <FormIntroCallout className="quote-public-link-notice" title="Link status">
          {notice}
        </FormIntroCallout>
      ) : null}
      {publicUrl ? (
        <>
          <label className="form-field panel-field-spaced">
            <FormFieldLabel>Public URL</FormFieldLabel>
            <input readOnly value={publicUrl} />
          </label>
          <ActionGroup className="filter-actions" label={publicLinkActionsLabel}>
            <button
              aria-label={`Copy public quote link for ${quoteNumber}`}
              className="button-secondary button-compact"
              onClick={copyLink}
              title={`Copy public quote link for ${quoteNumber}`}
              type="button"
            >
              Copy link
            </button>
            <button
              aria-label={`Revoke public quote link for ${quoteNumber}`}
              className="button-secondary button-compact"
              disabled={isSaving}
              onClick={revokeLink}
              title={`Revoke public quote link for ${quoteNumber}`}
              type="button"
            >
              {isSaving ? "Revoking..." : "Revoke link"}
            </button>
          </ActionGroup>
        </>
      ) : canGenerate ? (
        <button
          aria-label={`Generate public quote link for ${quoteNumber}`}
          className="button-primary button-compact"
          disabled={isSaving}
          onClick={generateLink}
          title={`Generate public quote link for ${quoteNumber}`}
          type="button"
        >
          {isSaving ? "Generating..." : "Generate public link"}
        </button>
      ) : (
        <EmptyState
          className="empty-state-compact empty-state-panel quote-public-link-empty"
          title="Quote not sent yet"
          description="Mark this quote sent before generating a public link."
        />
      )}
    </section>
  );
}
