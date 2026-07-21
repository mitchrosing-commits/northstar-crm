"use client";

import { useState } from "react";

export function AssistantCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button-secondary button-compact"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
      type="button"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
