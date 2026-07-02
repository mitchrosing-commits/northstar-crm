import type { ReactNode } from "react";

type ActionGroupProps = {
  children: ReactNode;
  className: string;
  label: string;
};

export function ActionGroup({ children, className, label }: ActionGroupProps) {
  return (
    <div aria-label={label} className={className} role="group" title={label}>
      {children}
    </div>
  );
}
