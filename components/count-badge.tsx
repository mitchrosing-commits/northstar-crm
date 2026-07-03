import type { ReactNode } from "react";

import { Badge } from "@/components/badge";

type CountBadgeProps = {
  children: ReactNode;
  className?: string;
  label?: string;
  title?: string;
};

export function CountBadge({ children, className = "count-badge", label, title = label }: CountBadgeProps) {
  return (
    <Badge className={className} label={label} title={title}>
      {children}
    </Badge>
  );
}
