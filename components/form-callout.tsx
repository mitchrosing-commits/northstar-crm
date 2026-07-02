import type { AriaRole, ReactNode } from "react";

type FormCalloutProps = {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  details?: ReactNode;
  role?: AriaRole;
  title: string;
  titleAttribute?: string;
};

export function FormCallout({
  ariaLabel,
  children,
  className,
  details,
  role,
  title,
  titleAttribute,
}: FormCalloutProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={["form-callout", className].filter(Boolean).join(" ")}
      role={role}
      title={titleAttribute}
    >
      <strong>{title}</strong>
      <p className="form-callout-copy">{children}</p>
      {details}
    </div>
  );
}
