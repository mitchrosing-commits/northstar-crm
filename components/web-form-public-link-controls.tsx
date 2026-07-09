"use client";

import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { FormSuccessMessage } from "@/components/form-success-message";

type WebFormPublicLinkControlsProps = {
  formName: string;
  isEnabled: boolean;
  publicUrl: string;
};

export function WebFormPublicLinkControls({ formName, isEnabled, publicUrl }: WebFormPublicLinkControlsProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const copyLabel = `Copy public web form link for ${formName}`;

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    setNotice("Public form link copied.");
  }

  return (
    <div className="web-form-link-controls">
      <label className="form-field">
        <span className="form-field-label">
          <span>Public URL</span>
        </span>
        <input
          aria-label={`Public web form URL for ${formName}. ${isEnabled ? "Enabled" : "Disabled"}`}
          readOnly
          value={publicUrl}
        />
      </label>
      <ActionGroup className="filter-actions" label={`${formName} public web form link actions`}>
        <button
          aria-label={copyLabel}
          className="button-secondary button-compact"
          onClick={copyLink}
          title={copyLabel}
          type="button"
        >
          Copy link
        </button>
      </ActionGroup>
      {notice ? (
        <FormSuccessMessage compact id={`${formName.replace(/\W+/g, "-").toLowerCase()}-copy-status`}>
          {notice}
        </FormSuccessMessage>
      ) : null}
    </div>
  );
}
