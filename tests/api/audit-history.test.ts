import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatAuditEvent } from "@/lib/audit-format";

const auditEventList = readFileSync(join(process.cwd(), "components/audit-event-list.tsx"), "utf8");
const auditHistoryPanel = readFileSync(join(process.cwd(), "components/audit-history-panel.tsx"), "utf8");
const dashboardPage = readFileSync(join(process.cwd(), "app/dashboard/page.tsx"), "utf8");

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
    expect(formatAuditEvent({ action: "custom_field_value.updated", metadata: { fieldIds: ["a", "b"] } }).metadataLabel).toBe(
      "2 custom fields updated"
    );
  });

  it("shares rendering between record history panels and dashboard recent changes", () => {
    expect(auditEventList).toContain("formatAuditEvent(entry)");
    expect(auditEventList).toContain("formatDate(entry.createdAt)");
    expect(auditEventList).toContain("event.actorLabel");
    expect(auditEventList).toContain("event.metadataLabel");
    expect(auditHistoryPanel).toContain("AuditEventList");
    expect(dashboardPage).toContain("AuditEventList");
    expect(dashboardPage).toContain("showTarget");
  });
});
