import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatAuditEvent } from "@/lib/audit-format";

const auditEventList = readFileSync(join(process.cwd(), "components/audit-event-list.tsx"), "utf8");
const auditHistoryPanel = readFileSync(join(process.cwd(), "components/audit-history-panel.tsx"), "utf8");
const panelTitleRow = readFileSync(join(process.cwd(), "components/panel-title-row.tsx"), "utf8");
const dashboardPage = readFileSync(join(process.cwd(), "app/dashboard/page.tsx"), "utf8");
const timelineMetaRow = readFileSync(join(process.cwd(), "components/timeline-meta-row.tsx"), "utf8");
const timelineBodyText = readFileSync(join(process.cwd(), "components/timeline-body-text.tsx"), "utf8");

describe("audit history formatting", () => {
  it("uses readable labels for common CRM events", () => {
    expect(formatAuditEvent({ action: "deal.stage_changed", entityType: "Deal" })).toMatchObject({
      label: "Moved deal stage",
      targetLabel: "Deal"
    });
    expect(formatAuditEvent({ action: "activity.deleted", entityType: "Activity" })).toMatchObject({
      label: "Removed activity",
      targetLabel: "Activity"
    });
    expect(formatAuditEvent({ action: "note.deleted", entityType: "Note" })).toMatchObject({
      label: "Removed note",
      targetLabel: "Note"
    });
    expect(formatAuditEvent({ action: "deal.reopened", entityType: "Deal" })).toMatchObject({
      label: "Reopened deal",
      targetLabel: "Deal"
    });
    expect(formatAuditEvent({ action: "workspace_member.ownership_transferred", entityType: "WorkspaceMembership" })).toMatchObject({
      label: "Transferred workspace ownership",
      targetLabel: "Workspace member"
    });
    expect(formatAuditEvent({ action: "workspace_member.removed", entityType: "WorkspaceMembership" })).toMatchObject({
      label: "Removed workspace member",
      targetLabel: "Workspace member"
    });
    expect(formatAuditEvent({ action: "workspace_invitation.accepted", entityType: "WorkspaceInvitation" })).toMatchObject({
      label: "Accepted workspace invitation",
      targetLabel: "Workspace invitation"
    });
    expect(formatAuditEvent({ action: "quote.public_accepted", entityType: "Quote" })).toMatchObject({
      label: "Customer accepted public quote",
      targetLabel: "Quote"
    });
    expect(formatAuditEvent({ action: "deal.value_synced_from_quote", entityType: "Deal" })).toMatchObject({
      label: "Synced deal value from quote",
      targetLabel: "Deal"
    });
    expect(formatAuditEvent({ action: "email_log.created", entityType: "EmailLog" })).toMatchObject({
      label: "Logged manual email",
      targetLabel: "Email log"
    });
    expect(formatAuditEvent({ action: "note.created", entityType: "Note" })).toMatchObject({
      label: "Added note",
      targetLabel: "Note"
    });
    expect(formatAuditEvent({ action: "deal.imported", entityType: "Deal" })).toMatchObject({
      label: "Imported deal from CSV",
      targetLabel: "Deal"
    });
    expect(formatAuditEvent({ action: "contact.imported", entityType: "Person" })).toMatchObject({
      label: "Imported contact from CSV",
      targetLabel: "Contact"
    });
    expect(formatAuditEvent({ action: "organization.imported", entityType: "Organization" })).toMatchObject({
      label: "Imported organization from CSV",
      targetLabel: "Organization"
    });
    expect(formatAuditEvent({ action: "lead.imported", entityType: "Lead" })).toMatchObject({
      label: "Imported lead from CSV",
      targetLabel: "Lead"
    });
  });

  it("uses explicit fallback labels for unknown audit actions", () => {
    expect(formatAuditEvent({ action: "legacy.event_name", entityType: "LegacyRecord" })).toMatchObject({
      label: "Recorded legacy event name",
      targetLabel: "Legacy Record"
    });
    expect(formatAuditEvent({ action: "" })).toMatchObject({
      label: "Recorded audit event"
    });
  });

  it("summarizes useful metadata without exposing raw JSON", () => {
    expect(formatAuditEvent({ action: "deal.lost", metadata: { lostReason: "Timing was wrong" } }).metadataLabel).toBe(
      "Lost reason: Timing was wrong"
    );
    expect(
      formatAuditEvent({
        action: "lead.converted",
        metadata: { reattachedActivities: 2, reattachedNotes: 1 }
      }).metadataLabel
    ).toBe("Moved 2 activities and 1 note");
    expect(
      formatAuditEvent({
        action: "lead.converted",
        metadata: { reattachedActivities: 2, reattachedNotes: 1, reattachedEmailLogs: 1 }
      }).metadataLabel
    ).toBe("Moved 2 activities, 1 note, and 1 email log");
    expect(formatAuditEvent({ action: "custom_field_value.updated", metadata: { fieldIds: ["a", "b"] } }).metadataLabel).toBe(
      "2 custom fields updated"
    );
  });

  it("shares rendering between record history panels and dashboard recent changes", () => {
    expect(auditEventList).toContain("formatAuditEvent(entry)");
    expect(auditEventList).toContain("formatDate(entry.createdAt)");
    expect(auditEventList).toContain("TimelineMetaRow");
    expect(auditEventList).toContain("className=\"timeline-item timeline-item-audit\"");
    expect(auditEventList).toContain("showTarget ? event.targetLabel : null");
    expect(auditEventList).toContain("event.actorLabel");
    expect(auditEventList).toContain("event.metadataLabel");
    expect(auditEventList).toContain("TimelineBodyText");
    expect(auditEventList).toContain("<TimelineBodyText>{event.metadataLabel}</TimelineBodyText>");
    expect(auditEventList).not.toContain('<p className="muted">{event.metadataLabel}</p>');
    expect(timelineMetaRow).toContain("timeline-meta");
    expect(timelineBodyText).toContain("timeline-body-text");
    expect(auditHistoryPanel).toContain("AuditEventList");
    expect(auditEventList).toContain("ariaLabel={`${event.label} audit event metadata`}");
    expect(auditHistoryPanel).toContain("EmptyState");
    expect(auditHistoryPanel).toContain("empty-state-compact empty-state-panel");
    expect(auditHistoryPanel).toContain("title={emptyMessage}");
    expect(auditHistoryPanel).toContain("PanelTitleRow");
    expect(auditHistoryPanel).toContain('import { CountBadge } from "@/components/count-badge"');
    expect(auditHistoryPanel).toContain("const auditCountLabel = `${entries.length} audit ${entries.length === 1 ? \"event\" : \"events\"}`");
    expect(auditHistoryPanel).toContain("<CountBadge label={auditCountLabel}>");
    expect(auditHistoryPanel).toContain("actionsLabel=\"Audit history event count\"");
    expect(auditHistoryPanel).toContain("description={description}");
    expect(auditHistoryPanel).toContain("Immutable workspace audit events for this record.");
    expect(panelTitleRow).toContain("panel-title-row");
    expect(auditHistoryPanel).toContain("className=\"data-card section-spaced\"");
    expect(auditHistoryPanel).toContain("id = \"audit-history\"");
    expect(auditHistoryPanel).toContain("id={id}");
    expect(dashboardPage).toContain("AuditEventList");
    expect(dashboardPage).toContain("showTarget");
  });
});
