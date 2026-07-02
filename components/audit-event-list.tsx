import { formatAuditEvent, type AuditDisplayEntry } from "@/lib/audit-format";
import { formatDate } from "@/components/format";
import { TimelineBodyText } from "@/components/timeline-body-text";
import { TimelineMetaRow } from "@/components/timeline-meta-row";

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

        return (
          <li className="timeline-item timeline-item-audit" key={entry.id}>
            <strong>{event.label}</strong>
            <TimelineMetaRow
              ariaLabel={`${event.label} audit event metadata`}
              items={[showTarget ? event.targetLabel : null, event.actorLabel, formatDate(entry.createdAt)]}
            />
            {event.metadataLabel ? <TimelineBodyText>{event.metadataLabel}</TimelineBodyText> : null}
          </li>
        );
      })}
    </ol>
  );
}
