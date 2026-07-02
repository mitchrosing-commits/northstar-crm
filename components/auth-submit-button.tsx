"use client";

import { useFormStatus } from "react-dom";

type AuthSubmitButtonProps = {
  actionLabel?: string;
  pendingLabel: string;
  submitLabel: string;
};

export function AuthSubmitButton({ actionLabel, pendingLabel, submitLabel }: AuthSubmitButtonProps) {
  const { pending } = useFormStatus();
  const resolvedActionLabel = actionLabel ?? submitLabel;

  return (
    <button aria-label={resolvedActionLabel} className="button-primary" disabled={pending} title={resolvedActionLabel} type="submit">
      {pending ? pendingLabel : submitLabel}
    </button>
  );
}
