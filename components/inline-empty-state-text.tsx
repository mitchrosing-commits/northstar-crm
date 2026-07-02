import type { ReactNode } from "react";

type InlineEmptyStateTextProps = {
  children: ReactNode;
  className?: string;
};

export function InlineEmptyStateText({ children, className }: InlineEmptyStateTextProps) {
  return (
    <span className={["muted inline-empty-state-text", className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
