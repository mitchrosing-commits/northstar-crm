"use client";

import { useState } from "react";

type DownloadActionProps = {
  actionLabel: string;
  className?: string;
  disabled?: boolean;
  filename?: string;
  helperId?: string;
  href: string;
  label: string;
  pendingLabel?: string;
  preparedLabel?: string;
};

export function DownloadAction({
  actionLabel,
  className = "button-secondary",
  disabled = false,
  filename,
  helperId,
  href,
  label,
  pendingLabel = "Preparing...",
  preparedLabel = "Download prepared"
}: DownloadActionProps) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const feedbackId = `${stableDownloadId(actionLabel)}-download-feedback`;
  const describedBy = [helperId, notice || error ? feedbackId : null].filter(Boolean).join(" ") || undefined;

  async function startDownload() {
    if (disabled || isPreparing) return;

    setError(null);
    setNotice(null);
    setIsPreparing(true);

    try {
      const response = await fetch(href, { method: "GET" });
      if (!response.ok) {
        setError(downloadFailureMessage(response.status));
        return;
      }

      const blob = await response.blob();
      const resolvedFilename = filenameFromContentDisposition(response.headers.get("content-disposition")) ?? filename;
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      if (resolvedFilename) anchor.download = resolvedFilename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
      setNotice(resolvedFilename ? `${preparedLabel}. Download started for ${resolvedFilename}.` : `${preparedLabel}. Download started.`);
    } catch {
      setError("Could not start the download. Try again.");
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <div className="download-action">
      <button
        aria-describedby={describedBy}
        aria-label={actionLabel}
        className={className}
        disabled={disabled || isPreparing}
        onClick={startDownload}
        title={actionLabel}
        type="button"
      >
        {isPreparing ? pendingLabel : label}
      </button>
      {notice ? (
        <p aria-live="polite" className="download-action-status compact-success" id={feedbackId} role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="download-action-status compact-error form-error" id={feedbackId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function filenameFromContentDisposition(header: string | null) {
  if (!header) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  return plainMatch?.[1] ?? null;
}

function downloadFailureMessage(status: number) {
  if (status === 401 || status === 403) return "You do not have permission to download this file.";
  if (status === 404) return "This download is no longer available.";
  return "Could not prepare the download. Try again.";
}

function stableDownloadId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "download";
}
