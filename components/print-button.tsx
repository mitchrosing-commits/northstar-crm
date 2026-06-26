"use client";

type PrintButtonProps = {
  label?: string;
};

export function PrintButton({ label = "Print" }: PrintButtonProps) {
  return (
    <button className="button-primary button-compact no-print" onClick={() => window.print()} type="button">
      {label}
    </button>
  );
}
