import type { ReactNode } from "react";

type FormErrorMessageProps = {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  id?: string;
};

export function FormErrorMessage({ children, className, compact = false, id }: FormErrorMessageProps) {
  const classNames = ["form-error", compact ? "compact-error" : null, className].filter(Boolean).join(" ");

  return (
    <p className={classNames} id={id} role="alert">
      {children}
    </p>
  );
}
