import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRecordTimeline } from "@/lib/services/timeline-service";

const timelineService = readFileSync(join(process.cwd(), "lib/services/timeline-service.ts"), "utf8");
const recordTimeline = readFileSync(join(process.cwd(), "components/record-timeline.tsx"), "utf8");
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");

describe("unified record timeline", () => {
  it("builds newest-first timeline items from notes, activities, and audit logs", () => {
    const timeline = buildRecordTimeline({
      notes: [
        {
          id: "note-1",
          body: "Customer asked for timeline clarity.",
          createdAt: "2030-01-01T10:00:00.000Z",
          author: { name: "Alex", email: "alex@example.test" }
        }
      ],
      activities: [
        {
          id: "activity-1",
          title: "Timeline call",
          type: "CALL",
          description: null,
          dueAt: "2030-01-03T10:00:00.000Z",
          completedAt: "2030-01-03T11:00:00.000Z",
          createdAt: "2030-01-02T10:00:00.000Z",
          owner: { name: "Riley", email: "riley@example.test" }
        }
      ],
      emailLogs: [
        {
          id: "email-1",
          subject: "Timeline email",
          body: "Customer replied by email.",
          direction: "INBOUND",
          occurredAt: "2030-01-03T12:00:00.000Z",
          fromText: "customer@example.test",
          toText: "seller@example.test",
          ccText: null,
          createdBy: { name: "Quinn", email: "quinn@example.test" }
        }
      ],
      auditLogs: [
        {
          id: "audit-1",
          action: "deal.updated",
          entityType: "Deal",
          entityId: "deal-1",
          metadata: { title: "Timeline deal" },
          createdAt: "2030-01-04T10:00:00.000Z",
          actor: { name: "Morgan", email: "morgan@example.test" }
        }
      ]
    });

    expect(timeline.map((item) => item.type)).toEqual(["audit", "email", "activity", "note"]);
    expect(timeline[0]).toMatchObject({ type: "audit" });
    expect(timeline[1]).toMatchObject({ type: "email", subject: "Timeline email", direction: "INBOUND" });
    expect(timeline[2]).toMatchObject({ type: "activity", completedAt: "2030-01-03T11:00:00.000Z" });
    expect(timeline[3]).toMatchObject({ type: "note", body: "Customer asked for timeline clarity." });
  });

  it("keeps invalid timeline timestamps deterministic at the end", () => {
    const timeline = buildRecordTimeline({
      notes: [
        {
          id: "note-invalid",
          body: "Missing imported timestamp.",
          createdAt: "not-a-date",
          author: { name: "Alex", email: "alex@example.test" }
        },
        {
          id: "note-valid",
          body: "Current note.",
          createdAt: "2030-01-01T10:00:00.000Z",
          author: { name: "Alex", email: "alex@example.test" }
        }
      ],
      activities: [],
      auditLogs: []
    });

    expect(timeline.map((item) => item.id)).toEqual(["note-note-valid", "note-note-invalid"]);
  });

  it("keeps same-timestamp timeline items in a deterministic source order", () => {
    const timestamp = "2030-01-01T10:00:00.000Z";
    const timeline = buildRecordTimeline({
      notes: [
        {
          id: "same-time-note",
          body: "Same-time note.",
          createdAt: timestamp,
          author: { name: "Alex", email: "alex@example.test" }
        }
      ],
      activities: [
        {
          id: "same-time-activity",
          title: "Same-time activity",
          type: "TASK",
          description: null,
          dueAt: null,
          completedAt: null,
          createdAt: timestamp,
          owner: { name: "Riley", email: "riley@example.test" }
        }
      ],
      emailLogs: [
        {
          id: "same-time-email",
          subject: "Same-time email",
          body: "Same-time email body.",
          direction: "OUTBOUND",
          occurredAt: timestamp,
          fromText: null,
          toText: null,
          ccText: null,
          createdBy: { name: "Quinn", email: "quinn@example.test" }
        }
      ],
      auditLogs: [
        {
          id: "same-time-audit",
          action: "deal.updated",
          entityType: "Deal",
          entityId: "deal-1",
          metadata: {},
          createdAt: timestamp,
          actor: { name: "Morgan", email: "morgan@example.test" }
        }
      ]
    });

    expect(timeline.map((item) => item.id)).toEqual([
      "note-same-time-note",
      "activity-same-time-activity",
      "email-same-time-email",
      "audit-same-time-audit"
    ]);
  });

  it("renders compact email timeline entries with safe participant fallbacks", () => {
    expect(recordTimeline).toContain("className=\"deal-meta email-meta\"");
    expect(recordTimeline).toContain("className=\"email-participant\"");
    expect(recordTimeline).toContain("formatEmailParticipant(item.fromText)");
    expect(recordTimeline).toContain("formatEmailParticipant(item.toText)");
    expect(recordTimeline).toContain("Not recorded");
    expect(recordTimeline).toContain("formatEmailPreview(item.body)");
  });

  it("keeps timeline reads workspace-scoped and filters deleted timeline records", () => {
    expect(timelineService).toContain("export async function getRecordTimeline");
    expect(timelineService).toContain("ensureWorkspaceAccess(actor)");
    expect(timelineService).toContain("assertRecordInWorkspace");
    expect(timelineService).toContain("...activeWhere");
    expect(timelineService).toContain("prisma.note.findMany");
    expect(timelineService).toContain("prisma.activity.findMany");
    expect(timelineService).toContain("prisma.emailLog.findMany");
    expect(timelineService).toContain("prisma.auditLog.findMany");
    expect(timelineService).toContain("Number.isFinite(time) ? time : 0");
    expect(timelineService).toContain("timelineTieRank");
  });

  it("renders a shared read-only timeline with audit formatting", () => {
    expect(recordTimeline).toContain("title = \"Timeline\"");
    expect(recordTimeline).toContain("No timeline activity yet.");
    expect(recordTimeline).toContain("formatAuditEvent(item.event)");
    expect(recordTimeline).toContain("<strong>{event.label}</strong>");
    expect(recordTimeline).toContain("Completed");
    expect(recordTimeline).toContain("formatActivityType(item.activityType)");
    expect(recordTimeline).toContain("formatActivityDueLine(item)");
    expect(recordTimeline).toContain("Was due");
    expect(recordTimeline).toContain("No due date");
    expect(recordTimeline).toContain("Added note");
    expect(recordTimeline).toContain("formatEmailTimelineLabel(item.direction)");
    expect(recordTimeline).toContain("Logged outbound email");
    expect(recordTimeline).toContain("Logged inbound email");
  });

  it("surfaces next-step and history context on deal detail pages", () => {
    expect(dealPage).toContain("DealNextStepCard");
    expect(dealPage).toContain("classifyDealAttention");
    expect(dealPage).toContain("dealAttentionLabel(attention)");
    expect(dealPage).toContain("No open activity is attached to this deal.");
    expect(dealPage).toContain("ActivityDueBadge");
    expect(dealPage).toContain("formatActivityType(activity.type)");
    expect(dealPage).toContain("History Snapshot");
    expect(dealPage).toContain("Open activities");
    expect(dealPage).toContain("Completed activities");
    expect(dealPage).toContain("Notes");
    expect(dealPage).toContain("Timeline events");
    expect(dealPage).toContain("title=\"Deal Timeline\"");
    expect(dealPage).toContain("Open Next Steps");
    expect(dealPage).toContain("Completed Activity History");
  });

  it("adds the unified timeline to primary record detail pages while preserving separate panels", () => {
    for (const page of [dealPage, leadPage, contactPage, organizationPage]) {
      expect(page).toContain("RecordTimeline");
      expect(page).toContain("getRecordTimeline");
      expect(page).toContain("NotesPanel");
      expect(page).toContain("RecordActivitiesPanel");
      expect(page).toContain("ManualEmailLogPanel");
      expect(page).toContain("AuditHistoryPanel");
    }
  });
});
