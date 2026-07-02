import type { ReactNode } from "react";

import { FormCallout } from "@/components/form-callout";

type LockedPanelNoticeProps = {
  children: ReactNode;
  title?: string;
};

export function LockedPanelNotice({ children, title = "Read-only" }: LockedPanelNoticeProps) {
  return (
    <FormCallout
      ariaLabel={title}
      className="locked-panel-notice"
      role="note"
      title={title}
      titleAttribute={title}
    >
      {children}
    </FormCallout>
  );
}
