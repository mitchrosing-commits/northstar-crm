"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type QuotePublicLinkControlsProps = {
  workspaceId: string;
  quoteId: string;
  publicUrl: string | null;
};

export function QuotePublicLinkControls({ workspaceId, quoteId, publicUrl }: QuotePublicLinkControlsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    <section className="data-card" style={{ marginTop: 14 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Public Quote Link</h2>
        <span className="badge">{publicUrl ? "Active" : "Not shared"}</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 14 }}>
        Public links are customer-facing quote views with optional acceptance while the quote is sent. Revoking a link immediately makes it return a safe 404. Links do not expose the CRM app, send email, capture signatures, or allow payment.
      </p>
      {error ? <div className="form-error">{error}</div> : null}
      {notice ? <p className="empty-copy">{notice}</p> : null}
      {publicUrl ? (
        <>
          <label className="form-field" style={{ marginBottom: 12 }}>
            <span>Public URL</span>
            <input readOnly value={publicUrl} />
          </label>
          <div className="filter-actions">
            <button className="button-secondary button-compact" onClick={copyLink} type="button">
              Copy link
            </button>
            <button className="button-secondary button-compact" disabled={isSaving} onClick={revokeLink} type="button">
              {isSaving ? "Revoking..." : "Revoke link"}
            </button>
          </div>
        </>
      ) : (
        <button className="button-primary button-compact" disabled={isSaving} onClick={generateLink} type="button">
          {isSaving ? "Generating..." : "Generate public link"}
        </button>
      )}
    </section>
  );
}
