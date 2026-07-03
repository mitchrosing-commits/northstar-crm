import type { ReactNode } from "react";

import { Badge } from "@/components/badge";

type AttentionBadgeProps = {
  children: ReactNode;
  classNamePrefix?: string;
  label?: string;
  title?: string;
  tone?: string;
};

export function AttentionBadge({
  children,
  classNamePrefix = "attention-kind",
  label,
  title = label,
  tone
}: AttentionBadgeProps) {
  const className = tone ? `${classNamePrefix} ${classNamePrefix}-${tone}` : classNamePrefix;

  return (
    <Badge className={className} label={label} title={title}>
      {children}
    </Badge>
  );
}
