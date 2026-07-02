import type { ReactNode } from "react";

type FormSuccessMessageProps = {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  id?: string;
};

export function FormSuccessMessage({ children, className, compact = false, id }: FormSuccessMessageProps) {
  const classNames = [compact ? "compact-success" : "form-success", className].filter(Boolean).join(" ");

  return (
    <p aria-live="polite" className={classNames} id={id} role="status">
      {children}
    </p>
  );
}
