import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { ActivityCompleteButton } from "@/components/activity-complete-button";
import { ActivityDeleteButton } from "@/components/activity-delete-button";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { formatActivityType } from "@/components/format";

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

type ActivityListProps = {
  activities: Activity[];
  workspaceId?: string;
  showCompleteAction?: boolean;
};

export function ActivityList({ activities, workspaceId, showCompleteAction = false }: ActivityListProps) {
  return (
    <ul className="activity-list">
      {activities.map((activity) => (
        <li className="activity-item" key={activity.id}>
          <span className="activity-icon" aria-hidden="true">
            <CalendarCheck size={16} aria-hidden="true" />
          </span>
          <div className="activity-content">
            <strong>{activity.title}</strong>
            {activity.description ? <p className="muted">{activity.description}</p> : null}
            <div className="deal-meta">
              <span>{formatActivityType(activity.type)}</span>
              <ActivityDueBadge activity={activity} />
              {activity.owner ? <span>{activity.owner.name ?? activity.owner.email}</span> : null}
              {activity.deal ? (
                <Link className="inline-link" href={`/deals/${activity.deal.id}`}>
                  {activity.deal.title}
                </Link>
              ) : null}
              {activity.lead ? (
                <Link className="inline-link" href={`/leads/${activity.lead.id}`}>
                  {activity.lead.title}
                </Link>
              ) : null}
              {activity.person ? (
                <Link className="inline-link" href={`/contacts/${activity.person.id}`}>
                  {formatPersonName(activity.person)}
                </Link>
              ) : null}
              {activity.organization ? (
                <Link className="inline-link" href={`/organizations/${activity.organization.id}`}>
                  {activity.organization.name}
                </Link>
              ) : null}
            </div>
            {workspaceId ? (
              <div className="activity-actions">
                {!activity.completedAt ? (
                  <Link className="button-secondary button-compact" href={`/activities/${activity.id}/edit`}>
                    Edit
                  </Link>
                ) : null}
                {showCompleteAction && !activity.completedAt ? (
                  <ActivityCompleteButton activityId={activity.id} inline workspaceId={workspaceId} />
                ) : null}
                <ActivityDeleteButton activityId={activity.id} workspaceId={workspaceId} />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
