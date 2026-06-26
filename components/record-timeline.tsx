import { formatAuditEvent } from "@/lib/audit-format";
import type { RecordTimelineItem } from "@/lib/services/timeline-service";
import { formatActivityType, formatDate } from "@/components/format";

type RecordTimelineProps = {
  emptyMessage?: string;
  items: RecordTimelineItem[];
  title?: string;
};

export function RecordTimeline({ emptyMessage = "No timeline activity yet.", items, title = "Timeline" }: RecordTimelineProps) {
  return (
    <section className="data-card" style={{ marginTop: 14 }}>
      <h2 className="panel-title">{title}</h2>
      {items.length > 0 ? (
        <ol className="timeline" aria-label="Unified record timeline">
          {items.map((item) => (
            <RecordTimelineItem key={item.id} item={item} />
          ))}
        </ol>
      ) : (
        <p className="empty-copy">{emptyMessage}</p>
      )}
    </section>
  );
}

function RecordTimelineItem({ item }: { item: RecordTimelineItem }) {
  if (item.type === "note") {
    return (
      <li className="timeline-item">
        <strong>Added note</strong>
        <span>
          {item.authorName} · {formatDate(item.timestamp)}
        </span>
        <p className="muted">{item.body}</p>
      </li>
    );
  }

  if (item.type === "activity") {
    const status = item.completedAt ? `Completed ${formatDate(item.completedAt)}` : "Open";
    return (
      <li className="timeline-item">
        <strong>{item.title}</strong>
        <span>
          Activity · {formatActivityType(item.activityType)} · {status} · {formatDate(item.timestamp)}
        </span>
        <div className="deal-meta">
          <span>{formatActivityDueLine(item)}</span>
          <span>{item.ownerName}</span>
        </div>
        {item.description ? <p className="muted">{item.description}</p> : null}
      </li>
    );
  }

  if (item.type === "email") {
    return (
      <li className="timeline-item">
        <strong>{item.subject}</strong>
        <span>
          {formatEmailTimelineLabel(item.direction)} · {formatDate(item.timestamp)}
        </span>
        <div className="deal-meta email-meta">
          <span className="email-participant">From {formatEmailParticipant(item.fromText)}</span>
          <span className="email-participant">To {formatEmailParticipant(item.toText)}</span>
          {item.ccText ? <span className="email-participant">Cc {item.ccText}</span> : null}
          <span className="email-participant">Logged by {item.createdByName}</span>
        </div>
        <p className="muted">{formatEmailPreview(item.body)}</p>
      </li>
    );
  }

  const event = formatAuditEvent(item.event);
  return (
    <li className="timeline-item">
      <strong>{event.label}</strong>
      <span>
        {event.actorLabel} · {formatDate(item.timestamp)}
      </span>
      {event.metadataLabel ? <p className="muted">{event.metadataLabel}</p> : null}
    </li>
  );
}

function formatEmailTimelineLabel(direction: string) {
  if (direction === "INBOUND") return "Logged inbound email";
  if (direction === "OUTBOUND") return "Logged outbound email";
  return "Logged email";
}

function formatActivityDueLine(activity: { completedAt?: Date | string | null; dueAt?: Date | string | null }) {
  if (!activity.dueAt) return "No due date";
  if (activity.completedAt) return `Was due ${formatDate(activity.dueAt)}`;
  return `Due ${formatDate(activity.dueAt)}`;
}

function formatEmailParticipant(value: string | null) {
  return value?.trim() ? value : "Not recorded";
}

function formatEmailPreview(body: string) {
  const compactBody = body.replace(/\s+/g, " ").trim();
  return compactBody.length > 220 ? `${compactBody.slice(0, 217)}...` : compactBody;
}
