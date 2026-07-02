import { useId, type ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";

type EmptyStateProps = {
  actions?: ReactNode;
  actionsLabel?: string;
  as?: "div" | "section";
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  leading?: ReactNode;
  title: ReactNode;
  titleId?: string;
  titleLevel?: "h1" | "h2" | "h3";
};

export function EmptyState({
  actions,
  actionsLabel = "Empty state actions",
  as: Component = "div",
  children,
  className,
  description,
  leading,
  title,
  titleId,
  titleLevel: Heading = "h3"
}: EmptyStateProps) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId ?? `${generatedTitleId}-empty-state-title`;
  const resolvedActionsLabel =
    actionsLabel === "Empty state actions" && typeof title === "string" ? `${title} actions` : actionsLabel;

  return (
    <Component
      aria-labelledby={resolvedTitleId}
      className={["empty-state", className].filter(Boolean).join(" ")}
    >
      {leading}
      <Heading id={resolvedTitleId}>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {children}
      {actions ? (
        <ActionGroup className="empty-state-actions filter-actions" label={resolvedActionsLabel}>
          {actions}
        </ActionGroup>
      ) : null}
    </Component>
  );
}
