import { AuditEventList } from "@/components/audit-event-list";
import type { AuditDisplayEntry } from "@/lib/audit-format";

type AuditEntry = AuditDisplayEntry & {
  id: string;
  createdAt: Date | string;
};

type AuditHistoryPanelProps = {
  entries: AuditEntry[];
  emptyMessage: string;
};

export function AuditHistoryPanel({ entries, emptyMessage }: AuditHistoryPanelProps) {
  return (
    <section className="data-card" style={{ marginTop: 14 }}>
      <h2 className="panel-title">Audit History</h2>
      {entries.length > 0 ? (
        <AuditEventList entries={entries} label="Audit events" />
      ) : (
        <p className="empty-copy">{emptyMessage}</p>
      )}
    </section>
  );
}
