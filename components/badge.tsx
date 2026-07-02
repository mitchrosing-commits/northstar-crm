import type { ReactNode } from "react";

type BadgeProps = {
  children: ReactNode;
  className?: string;
  label?: string;
  title?: string;
};

export function Badge({ children, className = "badge", label, title = label }: BadgeProps) {
  return (
    <span aria-label={label} className={className} title={title}>
      {children}
    </span>
  );
}
