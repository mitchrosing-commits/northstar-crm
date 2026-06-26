import { formatAuditEvent, type AuditDisplayEntry } from "@/lib/audit-format";
import { formatDate } from "@/components/format";

type AuditEventListProps = {
  entries: (AuditDisplayEntry & {
    id: string;
    createdAt: Date | string;
  })[];
  label: string;
  showTarget?: boolean;
};

export function AuditEventList({ entries, label, showTarget = false }: AuditEventListProps) {
  return (
    <ol className="timeline" aria-label={label}>
      {entries.map((entry) => {
        const event = formatAuditEvent(entry);
        const context = [showTarget ? event.targetLabel : undefined, event.actorLabel, formatDate(entry.createdAt)]
          .filter(Boolean)
          .join(" · ");

        return (
          <li className="timeline-item" key={entry.id}>
            <strong>{event.label}</strong>
            <span>{context}</span>
            {event.metadataLabel ? <p className="muted">{event.metadataLabel}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
