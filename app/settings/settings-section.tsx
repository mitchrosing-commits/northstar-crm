import type { ReactNode } from "react";

import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";

type SettingsSectionProps = {
  action?: ReactNode;
  badge?: string;
  children?: ReactNode;
  className?: string;
  id?: string;
  intro?: ReactNode;
  introClassName?: string;
  title: string;
  titleId?: string;
};

export function SettingsSection({
  action,
  badge,
  children,
  className = "panel section-separated",
  id,
  intro,
  introClassName = "empty-copy section-separated",
  title,
  titleId
}: SettingsSectionProps) {
  const badgeLabel = badge ? `${title}: ${badge}` : undefined;

  return (
    <section aria-labelledby={titleId} className={className} id={id}>
      <PanelTitleRow
        actions={action ?? (badge ? <Badge label={badgeLabel}>{badge}</Badge> : null)}
        title={title}
        titleId={titleId}
      />
      {intro ? <p className={introClassName}>{intro}</p> : null}
      {children}
    </section>
  );
}
