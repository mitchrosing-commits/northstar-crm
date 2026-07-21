"use client";

import { useFormStatus } from "react-dom";

type FormSubmitButtonProps = {
  ariaLabel?: string;
  className?: string;
  label: string;
  name?: string;
  pendingLabel?: string;
  title?: string;
  value?: string;
};

export function FormSubmitButton({
  ariaLabel,
  className = "button-primary",
  label,
  name,
  pendingLabel,
  title,
  value
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();
  const resolvedPendingLabel = pendingLabel ?? defaultPendingLabel(label);
  const resolvedLabel = pending ? resolvedPendingLabel : label;
  const resolvedAriaLabel = pending ? resolvedPendingLabel : ariaLabel ?? label;

  return (
    <button
      aria-label={resolvedAriaLabel}
      className={className}
      disabled={pending}
      name={name}
      title={pending ? resolvedPendingLabel : title ?? ariaLabel ?? label}
      type="submit"
      value={value}
    >
      {resolvedLabel}
    </button>
  );
}

function defaultPendingLabel(label: string) {
  const [verb = ""] = label.trim().split(/\s+/);
  const normalizedVerb = verb.toLowerCase();
  if (normalizedVerb === "delete" || normalizedVerb === "remove") return "Deleting...";
  if (normalizedVerb === "save") return "Saving...";
  if (normalizedVerb === "create" || normalizedVerb === "add") return "Creating...";
  return "Working...";
}
