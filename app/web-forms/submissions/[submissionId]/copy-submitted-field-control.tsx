"use client";

import { useState } from "react";

import { FormSuccessMessage } from "@/components/form-success-message";

type CopySubmittedFieldControlProps = {
  label: "email" | "phone";
  value: string;
};

export function CopySubmittedFieldControl({ label, value }: CopySubmittedFieldControlProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const accessibleLabel = `Copy submitted ${label}`;

  async function copyValue() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setNotice(`Submitted ${label} copied.`);
    } catch {
      setNotice(`Submitted ${label} could not be copied.`);
    }
  }

  return (
    <span className="web-form-copy-control">
      <button
        aria-label={accessibleLabel}
        className="button-secondary button-compact"
        onClick={copyValue}
        title={accessibleLabel}
        type="button"
      >
        Copy
      </button>
      {notice ? (
        <FormSuccessMessage compact>
          <span aria-live="polite">{notice}</span>
        </FormSuccessMessage>
      ) : null}
    </span>
  );
}
