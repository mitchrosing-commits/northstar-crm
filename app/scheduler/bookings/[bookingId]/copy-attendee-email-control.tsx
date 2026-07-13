"use client";

import { useState } from "react";

import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";

type CopyNotice = {
  message: string;
  tone: "error" | "success";
};

export function CopyAttendeeEmailControl({ value }: { value: string }) {
  const [notice, setNotice] = useState<CopyNotice | null>(null);

  async function copyValue() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setNotice({ message: "Attendee email copied.", tone: "success" });
    } catch {
      setNotice({ message: "Attendee email could not be copied.", tone: "error" });
    }
  }

  return (
    <span className="web-form-copy-control">
      <button
        aria-label="Copy attendee email"
        className="button-secondary button-compact"
        onClick={copyValue}
        title="Copy attendee email"
        type="button"
      >
        Copy
      </button>
      {notice?.tone === "success" ? <FormSuccessMessage compact>{notice.message}</FormSuccessMessage> : null}
      {notice?.tone === "error" ? <FormErrorMessage compact>{notice.message}</FormErrorMessage> : null}
    </span>
  );
}
