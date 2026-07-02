import { useId, type ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";

type PanelTitleRowProps = {
  actions?: ReactNode;
  actionsLabel?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
};

export function PanelTitleRow({
  actions,
  actionsLabel = "Panel actions",
  description,
  eyebrow,
  title,
  titleId
}: PanelTitleRowProps) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId ?? `${generatedTitleId}-panel-title`;
  const resolvedActionsLabel =
    actionsLabel === "Panel actions" && typeof title === "string" ? `${title} actions` : actionsLabel;

  return (
    <div className="panel-title-row">
      <div className="panel-title-copy">
        {eyebrow ? <p className="page-kicker">{eyebrow}</p> : null}
        <h2 className="panel-title" id={resolvedTitleId}>{title}</h2>
        {description ? <p className="form-hint">{description}</p> : null}
      </div>
      {actions ? (
        <ActionGroup className="panel-title-actions" label={resolvedActionsLabel}>
          {actions}
        </ActionGroup>
      ) : null}
    </div>
  );
}
