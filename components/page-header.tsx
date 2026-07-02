import { useId, type ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";

type PageHeaderProps = {
  actionsLabel?: string;
  actions?: ReactNode;
  children?: ReactNode;
  eyebrow: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  titleId?: string;
};

export function PageHeader({
  actions,
  actionsLabel = "Page actions",
  children,
  eyebrow,
  subtitle,
  title,
  titleId
}: PageHeaderProps) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId ?? `${generatedTitleId}-page-header-title`;
  const subtitleId = subtitle ? `${resolvedTitleId}-subtitle` : undefined;
  const resolvedActionsLabel =
    actionsLabel === "Page actions" && typeof title === "string" ? `${title} actions` : actionsLabel;

  return (
    <header aria-describedby={subtitleId} aria-labelledby={resolvedTitleId} className="page-header">
      <div className="page-header-copy">
        <p className="page-kicker">{eyebrow}</p>
        <h1 className="page-title" id={resolvedTitleId}>{title}</h1>
        {subtitle ? <p className="page-subtitle" id={subtitleId}>{subtitle}</p> : null}
        {children}
      </div>
      {actions ? (
        <ActionGroup className="header-actions" label={resolvedActionsLabel}>
          {actions}
        </ActionGroup>
      ) : null}
    </header>
  );
}
