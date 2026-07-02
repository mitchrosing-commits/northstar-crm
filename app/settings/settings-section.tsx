import type { ReactNode } from "react";

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
  return (
    <section aria-labelledby={titleId} className={className} id={id}>
      <PanelTitleRow
        actions={action ?? (badge ? <span className="badge">{badge}</span> : null)}
        title={title}
        titleId={titleId}
      />
      {intro ? <p className={introClassName}>{intro}</p> : null}
      {children}
    </section>
  );
}
