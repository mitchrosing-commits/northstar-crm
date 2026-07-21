import Link from "next/link";
import type { Route } from "next";

import { formatAuditEvent } from "@/lib/audit-format";
import type { RecordTimelineItem } from "@/lib/services/timeline-service";
import { ActionGroup } from "@/components/action-group";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { formatActivityType, formatDate } from "@/components/format";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TimelineBodyText } from "@/components/timeline-body-text";
import { TimelineMetaRow } from "@/components/timeline-meta-row";

type RecordTimelineProps = {
  description?: string;
  emptyMessage?: string;
  id?: string;
  items: RecordTimelineItem[];
  title?: string;
};

export function RecordTimeline({
  description = "Notes, activities, emails, and audit events in newest-first order.",
  emptyMessage = "No timeline activity yet.",
  id = "timeline",
  items,
  title = "Timeline"
}: RecordTimelineProps) {
  const timelineCountLabel = `${title} timeline event count: ${items.length}`;
  const summaryLabel = `Show ${items.length} ${items.length === 1 ? "timeline event" : "timeline events"}`;

  return (
    <section className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={
          <CountBadge label={timelineCountLabel}>
            {items.length}
          </CountBadge>
        }
        actionsLabel={`${title} timeline event count`}
        description={description}
        title={title}
      />
      {items.length > 0 ? (
        <details className="record-history-disclosure record-timeline-disclosure">
          <summary>{summaryLabel}</summary>
          <ol className="timeline" aria-label="Unified record timeline">
            {items.map((item) => (
              <RecordTimelineItem key={item.id} item={item} />
            ))}
          </ol>
        </details>
      ) : (
        <EmptyState className="empty-state-compact empty-state-panel" title={emptyMessage} />
      )}
    </section>
  );
}

function RecordTimelineItem({ item }: { item: RecordTimelineItem }) {
  if (item.type === "note") {
    const noteActionsLabel = `Note by ${item.authorName} timeline note actions`;

    return (
      <li className="timeline-item timeline-item-note" id={item.id}>
        <strong>Added note</strong>
        <TimelineMetaRow items={[item.authorName, formatDate(item.timestamp)]} ariaLabel={`Note by ${item.authorName} timeline metadata`} />
        <TimelineBodyText>{item.body}</TimelineBodyText>
        <ActionGroup className="timeline-item-actions" label={noteActionsLabel}>
          <Link
            aria-label={`Review notes for timeline note by ${item.authorName}`}
            className="button-secondary button-compact"
            href={"#notes" as Route}
            title={`Review notes for timeline note by ${item.authorName}`}
          >
            Review notes
          </Link>
        </ActionGroup>
      </li>
    );
  }

  if (item.type === "activity") {
    const activityActionsLabel = `${item.title} timeline activity actions`;

    return (
      <li className={item.completedAt ? "timeline-item timeline-item-completed" : "timeline-item timeline-item-open"} id={item.id}>
        <div className="timeline-item-heading">
          <strong>{item.title}</strong>
          <ActivityDueBadge activity={item} />
        </div>
        <TimelineMetaRow
          ariaLabel={`${item.title} activity timeline metadata`}
          items={[
            "Activity",
            formatActivityType(item.activityType),
            formatActivityStatus(item),
            formatDate(item.timestamp),
            item.ownerName,
            item.associationLabels.length > 0 ? `Associated with ${item.associationLabels.join("; ")}` : null
          ]}
        />
        {item.description ? <TimelineBodyText>{item.description}</TimelineBodyText> : null}
        <ActionGroup className="timeline-item-actions" label={activityActionsLabel}>
          <Link
            aria-label={`View timeline activity ${item.title}`}
            className="button-secondary button-compact"
            href={`/activities/${item.activityId}/edit` as Route}
            title={`View timeline activity ${item.title}`}
          >
            View activity
          </Link>
          {item.completedAt ? (
            <Link
              aria-label={`Add next follow-up after timeline activity ${item.title}`}
              className="button-secondary button-compact"
              href={"#add-activity" as Route}
              title={`Add next follow-up after timeline activity ${item.title}`}
            >
              Add follow-up
            </Link>
          ) : null}
        </ActionGroup>
      </li>
    );
  }

  if (item.type === "email") {
    const emailActionsLabel = `${item.subject} timeline email actions`;

    return (
      <li className="timeline-item timeline-item-email" id={item.id}>
        <strong>{item.subject}</strong>
        <TimelineMetaRow
          items={[formatEmailTimelineLabel(item.direction), formatDate(item.timestamp)]}
          ariaLabel={`${item.subject} email timeline metadata`}
        />
        <TimelineMetaRow
          ariaLabel={`${item.subject} email participant metadata`}
          className="email-meta"
          items={[
            `From ${formatEmailParticipant(item.fromText)}`,
            `To ${formatEmailParticipant(item.toText)}`,
            item.ccText ? `Cc ${item.ccText}` : null,
            `Logged by ${item.createdByName}`
          ]}
        />
        <TimelineBodyText>{formatEmailPreview(item.body)}</TimelineBodyText>
        <ActionGroup className="timeline-item-actions" label={emailActionsLabel}>
          <Link
            aria-label={`Review email log for ${item.subject}`}
            className="button-secondary button-compact"
            href={"#email-log" as Route}
            title={`Review email log for ${item.subject}`}
          >
            Review email log
          </Link>
        </ActionGroup>
      </li>
    );
  }

  const event = formatAuditEvent(item.event);
  const auditActionsLabel = `${event.label} timeline audit actions`;

  return (
    <li className="timeline-item timeline-item-audit" id={item.id}>
      <strong>{event.label}</strong>
      <TimelineMetaRow items={[event.actorLabel, formatDate(item.timestamp)]} ariaLabel={`${event.label} audit timeline metadata`} />
      {event.metadataLabel ? <TimelineBodyText>{event.metadataLabel}</TimelineBodyText> : null}
      <ActionGroup className="timeline-item-actions" label={auditActionsLabel}>
        <Link
          aria-label={`Review audit history for ${event.label}`}
          className="button-secondary button-compact"
          href={"#audit-history" as Route}
          title={`Review audit history for ${event.label}`}
        >
          Review audit history
        </Link>
      </ActionGroup>
    </li>
  );
}

function formatEmailTimelineLabel(direction: string) {
  if (direction === "INBOUND") return "Logged inbound email";
  if (direction === "OUTBOUND") return "Logged outbound email";
  return "Logged email";
}

function formatActivityStatus(activity: { completedAt?: Date | string | null }) {
  return activity.completedAt ? "Completed" : "Open";
}

function formatEmailParticipant(value: string | null) {
  return value?.trim() ? value : "Not recorded";
}

function formatEmailPreview(body: string) {
  const compactBody = body.replace(/\s+/g, " ").trim();
  return compactBody.length > 220 ? `${compactBody.slice(0, 217)}...` : compactBody;
}
