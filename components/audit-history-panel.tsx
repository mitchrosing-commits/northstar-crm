import { AuditEventList } from "@/components/audit-event-list";
import { EmptyState } from "@/components/empty-state";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AuditDisplayEntry } from "@/lib/audit-format";

type AuditEntry = AuditDisplayEntry & {
  id: string;
  createdAt: Date | string;
};

type AuditHistoryPanelProps = {
  description?: string;
  entries: AuditEntry[];
  emptyMessage: string;
  id?: string;
};

export function AuditHistoryPanel({
  description = "Immutable workspace audit events for this record.",
  entries,
  emptyMessage,
  id = "audit-history"
}: AuditHistoryPanelProps) {
  const auditCountLabel = `${entries.length} audit ${entries.length === 1 ? "event" : "events"}`;

  return (
    <section className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={
          <span aria-label={auditCountLabel} className="count-badge" title={auditCountLabel}>
            {entries.length}
          </span>
        }
        actionsLabel="Audit history event count"
        description={description}
        title="Audit History"
      />
      {entries.length > 0 ? (
        <AuditEventList entries={entries} label="Audit events" />
      ) : (
        <EmptyState className="empty-state-compact empty-state-panel" title={emptyMessage} />
      )}
    </section>
  );
}
