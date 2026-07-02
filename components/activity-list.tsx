import Link from "next/link";
import type { Route } from "next";
import { CalendarCheck } from "lucide-react";

import { ActionGroup } from "@/components/action-group";
import { ActivityCompleteButton } from "@/components/activity-complete-button";
import { ActivityDeleteButton } from "@/components/activity-delete-button";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { formatActivityType } from "@/components/format";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { TimelineMetaRow } from "@/components/timeline-meta-row";
import { activityRecordContext, summarizeActivityTiming } from "@/lib/activity-workflow";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { formatPersonName } from "@/lib/person-name";
import { recordOwnerLabel } from "@/lib/record-owner-label";

type Activity = {
  id: string;
  title: string;
  type: string;
  description?: string | null;
  dueAt: Date | string | null;
  completedAt: Date | string | null;
  deal?: { id: string; title: string } | null;
  lead?: { id: string; title: string } | null;
  owner?: { name: string | null; email: string } | null;
  person?: { id: string; firstName: string; lastName: string | null } | null;
  organization?: { id: string; name: string } | null;
};

type ActivityOwner = Activity["owner"];

type ActivityListProps = {
  activities: Activity[];
  workspaceId?: string;
  showCompleteAction?: boolean;
};

export function ActivityList({ activities, workspaceId, showCompleteAction = false }: ActivityListProps) {
  return (
    <ul className="activity-list">
      {activities.map((activity) => (
        <ActivityListItem activity={activity} key={activity.id} showCompleteAction={showCompleteAction} workspaceId={workspaceId} />
      ))}
    </ul>
  );
}

function ActivityListItem({
  activity,
  showCompleteAction,
  workspaceId
}: {
  activity: Activity;
  showCompleteAction: boolean;
  workspaceId?: string;
}) {
  const timing = summarizeActivityTiming(activity);
  const related = activityRecordContext(activity);
  const followUpHref = related
    ? buildActivityFollowUpHref({
        related: { type: related.type, id: related.id },
        returnTo: related.href,
        title: `Follow up: ${related.label}`
      })
    : null;
  const stateLabel = timing.isOpen ? "Open follow-up" : "Completed follow-up";
  const activityActionsLabel = `${activity.title} activity actions`;
  const activityWorkspaceLabel = activity.completedAt
    ? `View completed activity ${activity.title}`
    : `Edit activity ${activity.title}`;

  return (
    <li className={activity.completedAt ? "activity-item activity-item-completed" : "activity-item activity-item-open"}>
      <span className="activity-icon" aria-hidden="true">
        <CalendarCheck size={16} aria-hidden="true" />
      </span>
      <div className="activity-content">
        <div className="activity-row-header">
          <div className="activity-title-group">
            {workspaceId ? (
              <Link
                aria-label={activityWorkspaceLabel}
                className="inline-link"
                href={`/activities/${activity.id}/edit`}
                title={activityWorkspaceLabel}
              >
                <strong>{activity.title}</strong>
              </Link>
            ) : (
              <strong>{activity.title}</strong>
            )}
            <span>{formatActivityType(activity.type)}</span>
          </div>
          <ActivityDueBadge activity={activity} />
        </div>
        <TimelineMetaRow
          ariaLabel={`${activity.title} activity metadata`}
          className="activity-context-line"
          items={[
            stateLabel,
            activityOwnerMetaLabel(activity.owner),
            timing.label
          ]}
        />
        {activity.description ? <p className="activity-description">{activity.description}</p> : null}
        <ActivityRelatedLinks activity={activity} />
        {workspaceId ? (
          <ActionGroup className="activity-actions" label={activityActionsLabel}>
            {!activity.completedAt ? (
              <Link
                aria-label={`Edit activity ${activity.title}`}
                className="button-secondary button-compact"
                href={`/activities/${activity.id}/edit`}
                title={`Edit activity ${activity.title}`}
              >
                Edit
              </Link>
            ) : (
              <Link
                aria-label={`View completed activity ${activity.title}`}
                className="button-secondary button-compact"
                href={`/activities/${activity.id}/edit`}
                title={`View completed activity ${activity.title}`}
              >
                View
              </Link>
            )}
            {activity.completedAt && followUpHref ? (
              <Link
                aria-label={`Create next follow-up after ${activity.title}`}
                className="button-secondary button-compact"
                href={followUpHref}
                title={`Create next follow-up after ${activity.title}`}
              >
                Next follow-up
              </Link>
            ) : null}
            {showCompleteAction && !activity.completedAt ? (
              <ActivityCompleteButton
                activityId={activity.id}
                ariaLabel={`Mark activity ${activity.title} complete`}
                inline
                workspaceId={workspaceId}
              />
            ) : null}
            {!activity.completedAt ? (
              <ActivityDeleteButton
                activityId={activity.id}
                ariaLabel={`Remove activity ${activity.title}`}
                workspaceId={workspaceId}
              />
            ) : null}
          </ActionGroup>
        ) : null}
      </div>
    </li>
  );
}

function ActivityRelatedLinks({ activity }: { activity: Activity }) {
  const links = [
    activity.deal ? { href: `/deals/${activity.deal.id}`, label: activity.deal.title, type: "Deal" } : null,
    activity.lead ? { href: `/leads/${activity.lead.id}`, label: activity.lead.title, type: "Lead" } : null,
    activity.person
      ? { href: `/contacts/${activity.person.id}`, label: formatPersonName(activity.person) ?? "Unnamed contact", type: "Contact" }
      : null,
    activity.organization
      ? { href: `/organizations/${activity.organization.id}`, label: activity.organization.name, type: "Organization" }
      : null
  ].filter((link): link is { href: string; label: string; type: string } => Boolean(link));

  if (links.length === 0) {
    return <InlineEmptyStateText className="activity-related-empty">No related CRM record linked</InlineEmptyStateText>;
  }

  return (
    <div className="activity-related-links" aria-label={`${activity.title} related records`}>
      {links.map((link) => {
        const relatedRecordLabel = `Open ${link.type.toLowerCase()} ${link.label} from activity ${activity.title}`;

        return (
          <Link
            aria-label={relatedRecordLabel}
            className="field-link"
            href={link.href as Route}
            key={`${link.type}:${link.href}`}
            title={relatedRecordLabel}
          >
            <span>{link.type}</span>
            <strong>{link.label}</strong>
          </Link>
        );
      })}
    </div>
  );
}

export function activityOwnerMetaLabel(owner: ActivityOwner) {
  return recordOwnerLabel(owner);
}
