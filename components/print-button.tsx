"use client";

type PrintButtonProps = {
  actionLabel?: string;
  label?: string;
};

export function PrintButton({ actionLabel, label = "Print" }: PrintButtonProps) {
  const resolvedActionLabel = actionLabel ?? label;

  return (
    <button
      aria-label={resolvedActionLabel}
      className="button-primary button-compact no-print"
      onClick={() => window.print()}
      title={resolvedActionLabel}
      type="button"
    >
      {label}
    </button>
  );
}
