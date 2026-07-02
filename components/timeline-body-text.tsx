import type { ReactNode } from "react";

type TimelineBodyTextProps = {
  children: ReactNode;
  className?: string;
};

export function TimelineBodyText({ children, className }: TimelineBodyTextProps) {
  return (
    <p className={["muted timeline-body-text", className].filter(Boolean).join(" ")}>
      {children}
    </p>
  );
}
