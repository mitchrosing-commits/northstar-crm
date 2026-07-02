import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

import { CompactTitleRow } from "@/components/compact-title-row";

type SettingsGuideCardProps = {
  actionLabel: string;
  children: ReactNode;
  href: ComponentProps<typeof Link>["href"];
  title: string;
};

export function SettingsGuideCard({ actionLabel, children, href, title }: SettingsGuideCardProps) {
  const guideActionLabel = `${title}: ${actionLabel}`;

  return (
    <div>
      <CompactTitleRow title={title} />
      {children}
      <Link aria-label={guideActionLabel} className="inline-link" href={href} title={guideActionLabel}>
        {actionLabel}
      </Link>
    </div>
  );
}
