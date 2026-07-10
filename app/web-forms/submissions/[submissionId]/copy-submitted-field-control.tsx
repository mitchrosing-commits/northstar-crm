"use client";

import { useState } from "react";

import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";

type CopySubmittedFieldControlProps = {
  label: "email" | "phone";
  value: string;
};
type CopyNotice = {
  message: string;
  tone: "error" | "success";
};

export function CopySubmittedFieldControl({ label, value }: CopySubmittedFieldControlProps) {
  const [notice, setNotice] = useState<CopyNotice | null>(null);
  const accessibleLabel = `Copy submitted ${label}`;

  async function copyValue() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setNotice({ message: `Submitted ${label} copied.`, tone: "success" });
    } catch {
      setNotice({ message: `Submitted ${label} could not be copied.`, tone: "error" });
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
      {notice?.tone === "success" ? <FormSuccessMessage compact>{notice.message}</FormSuccessMessage> : null}
      {notice?.tone === "error" ? <FormErrorMessage compact>{notice.message}</FormErrorMessage> : null}
    </span>
  );
}
