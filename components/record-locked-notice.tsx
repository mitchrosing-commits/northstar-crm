import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";

type RecordLockedNoticeAction = {
  href: Route | string;
  label: string;
  variant?: "primary" | "secondary";
};

type RecordLockedNoticeProps = {
  actions: RecordLockedNoticeAction[];
  badge?: ReactNode;
  children: ReactNode;
  title: string;
};

export function RecordLockedNotice({ actions, badge, children, title }: RecordLockedNoticeProps) {
  return (
    <EmptyState
      actions={actions.map((action) => {
        const actionLabel = `${action.label}: ${title}`;
        return (
          <Link
            aria-label={actionLabel}
            className={action.variant === "primary" ? "button-primary" : "button-secondary"}
            href={action.href as Route}
            key={`${action.href}-${action.label}`}
            title={actionLabel}
          >
            {action.label}
          </Link>
        );
      })}
      actionsLabel="Locked record actions"
      as="section"
      className="record-locked-notice"
      description={children}
      leading={badge}
      title={title}
      titleLevel="h2"
    />
  );
}
