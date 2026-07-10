"use client";

import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { FormSuccessMessage } from "@/components/form-success-message";

type SchedulerPublicLinkControlsProps = {
  isEnabled: boolean;
  publicUrl: string;
  schedulerName: string;
};

export function SchedulerPublicLinkControls({ isEnabled, publicUrl, schedulerName }: SchedulerPublicLinkControlsProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const copyLabel = `Copy public scheduler link for ${schedulerName}`;

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    setNotice("Public scheduler link copied.");
  }

  return (
    <div className="scheduler-link-controls">
      <label className="form-field">
        <span className="form-field-label">
          <span>Public URL</span>
        </span>
        <input
          aria-label={`Public scheduler URL for ${schedulerName}. ${isEnabled ? "Enabled" : "Disabled"}`}
          readOnly
          value={publicUrl}
        />
      </label>
      <ActionGroup className="filter-actions" label={`${schedulerName} public scheduler link actions`}>
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
        <FormSuccessMessage compact id={`${schedulerName.replace(/\W+/g, "-").toLowerCase()}-copy-status`}>
          {notice}
        </FormSuccessMessage>
      ) : null}
    </div>
  );
}
