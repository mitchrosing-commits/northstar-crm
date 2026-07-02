import { useId, type ReactNode } from "react";

type TableScrollProps = {
  "aria-label": string;
  children: ReactNode;
  className?: string;
  hint?: string;
  hintId?: string;
};

export function TableScroll({
  "aria-label": ariaLabel,
  children,
  className,
  hint,
  hintId
}: TableScrollProps) {
  const generatedHintId = useId();
  const resolvedHintId = hintId ?? `${generatedHintId}-table-scroll-hint`;
  const resolvedHint =
    hint ?? `${ariaLabel} may scroll horizontally on narrow screens. Use horizontal scrolling or keyboard arrow keys while focused to review every column.`;

  return (
    <div
      aria-describedby={resolvedHintId}
      aria-label={ariaLabel}
      className={["table-scroll", className].filter(Boolean).join(" ")}
      role="region"
      tabIndex={0}
      title={resolvedHint}
    >
      <span className="sr-only table-scroll-hint" id={resolvedHintId}>
        {resolvedHint}
      </span>
      {children}
    </div>
  );
}
