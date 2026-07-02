import Link from "next/link";
import { useId } from "react";
import type { Route } from "next";

import { ActionGroup } from "@/components/action-group";

type FormActionBarProps = {
  actionsLabel?: string;
  cancelHref?: Route;
  cancelLabel?: string;
  compact?: boolean;
  disabledHint?: string;
  disabledHintId?: string;
  isSaving: boolean;
  pendingLabel?: string;
  submitActionLabel?: string;
  submitDisabled?: boolean;
  submitLabel: string;
};

export function FormActionBar({
  actionsLabel = "Form actions",
  cancelHref,
  cancelLabel = "Cancel",
  compact = false,
  disabledHint = "Complete required fields to continue.",
  disabledHintId,
  isSaving,
  pendingLabel,
  submitActionLabel,
  submitDisabled = false,
  submitLabel
}: FormActionBarProps) {
  const showDisabledHint = submitDisabled && !isSaving;
  const generatedHintId = useId();
  const hintId = disabledHintId ?? `${generatedHintId}-form-action-hint`;
  const resolvedPendingLabel = pendingLabel ?? defaultPendingLabel(submitLabel);
  const resolvedSubmitActionLabel = submitActionLabel ?? submitLabel;
  const submitAriaLabel = isSaving ? resolvedPendingLabel : resolvedSubmitActionLabel;
  const submitTitle = showDisabledHint ? `${submitAriaLabel}: ${disabledHint}` : submitAriaLabel;
  const resolvedActionsLabel = actionsLabel === "Form actions" ? `${resolvedSubmitActionLabel} form actions` : actionsLabel;
  const cancelActionLabel = cancelLabel === "Cancel" ? `Cancel ${submitLabel.toLowerCase()} form` : cancelLabel;
  const actionBarClassName = ["form-actions", compact ? "form-actions-compact" : null].filter(Boolean).join(" ");

  return (
    <ActionGroup className={actionBarClassName} label={resolvedActionsLabel}>
      <button
        aria-describedby={showDisabledHint ? hintId : undefined}
        aria-label={submitAriaLabel}
        className={compact ? "button-primary button-compact" : "button-primary"}
        disabled={submitDisabled || isSaving}
        title={submitTitle}
        type="submit"
      >
        {isSaving ? resolvedPendingLabel : submitLabel}
      </button>
      {cancelHref ? (
        <Link aria-label={cancelActionLabel} className="button-secondary" href={cancelHref} title={cancelActionLabel}>
          {cancelLabel}
        </Link>
      ) : null}
      {showDisabledHint ? (
        <p aria-live="polite" className="form-action-hint" id={hintId}>
          {disabledHint}
        </p>
      ) : null}
    </ActionGroup>
  );
}

function defaultPendingLabel(submitLabel: string) {
  const [verb = ""] = submitLabel.trim().split(/\s+/);
  const normalizedVerb = verb.toLowerCase();
  if (normalizedVerb === "create" || normalizedVerb === "add") return "Creating...";
  if (normalizedVerb === "convert") return "Converting...";
  if (normalizedVerb === "move") return "Moving...";
  if (normalizedVerb === "update") return "Updating...";
  return "Saving...";
}
