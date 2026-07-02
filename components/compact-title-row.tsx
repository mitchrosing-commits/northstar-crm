import { useId, type ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";

type CompactTitleRowProps = {
  actions?: ReactNode;
  actionsLabel?: string;
  description?: ReactNode;
  title: ReactNode;
  titleId?: string;
};

export function CompactTitleRow({
  actions,
  actionsLabel = "Panel actions",
  description,
  title,
  titleId
}: CompactTitleRowProps) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId ?? `${generatedTitleId}-compact-title`;
  const resolvedActionsLabel =
    actionsLabel === "Panel actions" && typeof title === "string" ? `${title} actions` : actionsLabel;

  return (
    <div className="panel-title-row">
      <div className="panel-title-copy">
        <h3 className="compact-title" id={resolvedTitleId}>{title}</h3>
        {description ? <p className="empty-copy">{description}</p> : null}
      </div>
      {actions ? (
        <ActionGroup className="panel-title-actions" label={resolvedActionsLabel}>
          {actions}
        </ActionGroup>
      ) : null}
    </div>
  );
}
