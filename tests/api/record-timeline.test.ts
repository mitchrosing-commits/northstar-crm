import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRecordTimeline } from "@/lib/services/timeline-service";

const timelineService = readFileSync(join(process.cwd(), "lib/services/timeline-service.ts"), "utf8");
const recordTimeline = readFileSync(join(process.cwd(), "components/record-timeline.tsx"), "utf8");
const timelineMetaRow = readFileSync(join(process.cwd(), "components/timeline-meta-row.tsx"), "utf8");
const timelineBodyText = readFileSync(join(process.cwd(), "components/timeline-body-text.tsx"), "utf8");
const panelTitleRow = readFileSync(join(process.cwd(), "components/panel-title-row.tsx"), "utf8");
const detailFieldGrid = readFileSync(join(process.cwd(), "components/detail-field-grid.tsx"), "utf8");
const recordPanelJumpNav = readFileSync(join(process.cwd(), "components/record-panel-jump-nav.tsx"), "utf8");
const recordSummary = readFileSync(join(process.cwd(), "components/record-summary.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const personName = readFileSync(join(process.cwd(), "lib/person-name.ts"), "utf8");
const recordActivityCopy = readFileSync(join(process.cwd(), "lib/record-activity-copy.ts"), "utf8");

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
    expect(timeline[2]).toMatchObject({ type: "activity", activityId: "activity-1", completedAt: "2030-01-03T11:00:00.000Z" });
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

  it("keeps structured meeting association labels on activity timeline items", () => {
    const timeline = buildRecordTimeline({
      notes: [],
      activities: [
        {
          id: "meeting-activity-1",
          title: "Meeting: Alpha Needle Deal",
          type: "MEETING",
          description: "Summary: Reviewed implementation risk.",
          dueAt: null,
          completedAt: "2030-01-03T11:00:00.000Z",
          createdAt: "2030-01-02T10:00:00.000Z",
          owner: { name: "Riley", email: "riley@example.test" },
          meetingAssociations: [
            { deal: { title: "Alpha Needle Deal" }, lead: null, organization: null, person: null },
            { deal: null, lead: null, organization: { name: "Alpha Orbit Organization" }, person: null },
            {
              deal: null,
              lead: null,
              organization: null,
              person: { email: "alpha@example.test", firstName: "Alpha", lastName: "Contact" }
            }
          ]
        }
      ],
      auditLogs: []
    });

    expect(timeline[0]).toMatchObject({
      associationLabels: ["Deal: Alpha Needle Deal", "Organization: Alpha Orbit Organization", "Contact: Alpha Contact"],
      type: "activity"
    });
  });

  it("renders compact email timeline entries with safe participant fallbacks", () => {
    expect(recordTimeline).toContain("TimelineMetaRow");
    expect(recordTimeline).toContain("className=\"email-meta\"");
    expect(recordTimeline).toContain("`From ${formatEmailParticipant(item.fromText)}`");
    expect(recordTimeline).toContain("`To ${formatEmailParticipant(item.toText)}`");
    expect(recordTimeline).toContain("item.ccText ? `Cc ${item.ccText}` : null");
    expect(recordTimeline).toContain("`Logged by ${item.createdByName}`");
    expect(recordTimeline).toContain("formatEmailParticipant(item.fromText)");
    expect(recordTimeline).toContain("formatEmailParticipant(item.toText)");
    expect(recordTimeline).toContain("Not recorded");
    expect(recordTimeline).toContain("formatEmailPreview(item.body)");
    expect(recordTimeline).toContain("href={\"#email-log\" as Route}");
    expect(recordTimeline).toContain("Review email log");
  });

  it("uses shared timeline metadata rows for scannable history context", () => {
    expect(timelineMetaRow).toContain("export function TimelineMetaRow");
    expect(timelineMetaRow).toContain("[\"timeline-meta\", className].filter(Boolean).join(\" \")");
    expect(timelineMetaRow).toContain("ariaLabel = \"Timeline metadata\"");
    expect(timelineMetaRow).toContain("aria-label={ariaLabel}");
    expect(timelineMetaRow).toContain("role=\"list\"");
    expect(timelineMetaRow).toContain("className=\"timeline-meta-chip\"");
    expect(timelineMetaRow).toContain("role=\"listitem\"");
    expect(timelineMetaRow).toContain("title={timelineMetaItemTitle(item)}");
    expect(timelineMetaRow).toContain("normalizeTimelineMetaItem");
    expect(timelineMetaRow).toContain("typeof item === \"string\" ? item.trim() : item");
    expect(timelineMetaRow).toContain("isVisibleMetaItem");
    expect(timelineMetaRow).toContain("item !== null && item !== undefined && item !== false && item !== \"\"");
    expect(timelineMetaRow).toContain("typeof item === \"string\" || typeof item === \"number\" ? String(item) : undefined");
    expect(recordTimeline).toContain("TimelineMetaRow items={[item.authorName, formatDate(item.timestamp)]}");
    expect(recordTimeline).toContain("ariaLabel={`Note by ${item.authorName} timeline metadata`}");
    expect(recordTimeline).toContain("ariaLabel={`${item.title} activity timeline metadata`}");
    expect(recordTimeline).toContain("ariaLabel={`${item.subject} email timeline metadata`}");
    expect(recordTimeline).toContain("ariaLabel={`${item.subject} email participant metadata`}");
    expect(recordTimeline).toContain("ariaLabel={`${event.label} audit timeline metadata`}");
    expect(recordTimeline).toContain("formatActivityStatus(item)");
    expect(recordTimeline).toContain("<ActivityDueBadge activity={item} />");
    expect(recordTimeline).toContain("item.associationLabels.length > 0 ? `Associated with ${item.associationLabels.join(\"; \")}` : null");
    expect(recordTimeline).toContain("TimelineMetaRow items={[event.actorLabel, formatDate(item.timestamp)]}");
    expect(globalStyles).toContain(".timeline-meta-chip");
    expect(globalStyles).toContain(".activity-context-line");
  });

  it("uses shared timeline body text for narrative history details", () => {
    expect(timelineBodyText).toContain("export function TimelineBodyText");
    expect(timelineBodyText).toContain("\"muted timeline-body-text\"");
    expect(timelineBodyText).toContain("className].filter(Boolean).join(\" \")");
    expect(recordTimeline).toContain("import { TimelineBodyText }");
    expect(recordTimeline).toContain("<TimelineBodyText>{item.body}</TimelineBodyText>");
    expect(recordTimeline).toContain("<TimelineBodyText>{item.description}</TimelineBodyText>");
    expect(recordTimeline).toContain("<TimelineBodyText>{formatEmailPreview(item.body)}</TimelineBodyText>");
    expect(recordTimeline).toContain("<TimelineBodyText>{event.metadataLabel}</TimelineBodyText>");
    expect(recordTimeline).not.toContain('<p className="muted">{item.body}</p>');
    expect(recordTimeline).not.toContain('<p className="muted">{item.description}</p>');
    expect(recordTimeline).not.toContain('<p className="muted">{formatEmailPreview(item.body)}</p>');
    expect(recordTimeline).not.toContain('<p className="muted">{event.metadataLabel}</p>');
    expect(globalStyles).toContain(".timeline-body-text");
  });

  it("uses a shared panel title row for record workspace panels", () => {
    expect(panelTitleRow).toContain("import { useId, type ReactNode } from \"react\"");
    expect(panelTitleRow).toContain("export function PanelTitleRow");
    expect(panelTitleRow).toContain("titleId?: string");
    expect(panelTitleRow).toContain("const generatedTitleId = useId()");
    expect(panelTitleRow).toContain("const resolvedTitleId = titleId ?? `${generatedTitleId}-panel-title`");
    expect(panelTitleRow).toContain("className=\"panel-title-row\"");
    expect(panelTitleRow).toContain("className=\"panel-title-copy\"");
    expect(panelTitleRow).toContain("className=\"panel-title\"");
    expect(panelTitleRow).toContain("id={resolvedTitleId}");
    expect(panelTitleRow).toContain("className=\"page-kicker\"");
    expect(panelTitleRow).toContain("className=\"form-hint\"");
    expect(panelTitleRow).toContain("actionsLabel = \"Panel actions\"");
    expect(panelTitleRow).toContain("const resolvedActionsLabel");
    expect(panelTitleRow).toContain("actionsLabel === \"Panel actions\" && typeof title === \"string\" ? `${title} actions` : actionsLabel");
    expect(panelTitleRow).toContain("import { ActionGroup }");
    expect(panelTitleRow).toContain("<ActionGroup className=\"panel-title-actions\" label={resolvedActionsLabel}>");
    expect(globalStyles).toContain(".panel-title-copy");
    expect(globalStyles).toContain("overflow-wrap: anywhere");
    expect(globalStyles).toContain(".panel-title-actions");
    expect(recordTimeline).toContain("PanelTitleRow");
    expect(recordTimeline).toContain("EmptyState");
    expect(recordTimeline).toContain("empty-state-compact empty-state-panel");
    expect(recordTimeline).toContain("const timelineCountLabel = `${title} timeline event count: ${items.length}`");
    expect(recordTimeline).toContain("aria-label={timelineCountLabel}");
    expect(recordTimeline).toContain("title={timelineCountLabel}");
    expect(recordTimeline).toContain("actionsLabel={`${title} timeline event count`}");
    expect(recordTimeline).toContain("description={description}");
    expect(recordTimeline).toContain("Notes, activities, emails, and audit events in newest-first order.");
    expect(recordTimeline).toContain("title={title}");
  });

  it("uses the shared panel title row for detail field grids", () => {
    expect(detailFieldGrid).toContain("PanelTitleRow");
    expect(detailFieldGrid).toContain("import { useId, type ReactNode } from \"react\"");
    expect(detailFieldGrid).toContain('import { InlineEmptyStateText } from "@/components/inline-empty-state-text"');
    expect(detailFieldGrid).toContain("emptyLabel?: string");
    expect(detailFieldGrid).toContain("value?: ReactNode | null");
    expect(detailFieldGrid).toContain('const isEmpty = field.value === null || field.value === undefined || field.value === ""');
    expect(detailFieldGrid).toContain("<InlineEmptyStateText>{field.emptyLabel ?? \"Not set\"}</InlineEmptyStateText>");
    expect(detailFieldGrid).toContain(") : (\n                  field.value\n                )}");
    expect(detailFieldGrid).toContain("const titleId = `${useId()}-detail-field-grid-title`");
    expect(detailFieldGrid).toContain("<section aria-labelledby={titleId} className=\"data-card\">");
    expect(detailFieldGrid).toContain("<PanelTitleRow title={title} titleId={titleId} />");
    expect(detailFieldGrid).toContain("className=\"field-grid-item\"");
    expect(globalStyles).toContain(".field-grid > *");
    expect(globalStyles).toContain(".field-grid-item");
    expect(detailFieldGrid).not.toContain("<h2 className=\"panel-title\">{title}</h2>");
  });

  it("keeps timeline reads workspace-scoped and filters deleted timeline records", () => {
    expect(timelineService).toContain("export async function getRecordTimeline");
    expect(timelineService).toContain("ensureWorkspaceAccess(actor)");
    expect(timelineService).toContain("normalizeTimelineRecordType(record.type)");
    expect(timelineService).toContain("Timeline record type must be DEAL, LEAD, PERSON, or ORGANIZATION.");
    expect(timelineService).toContain("assertRecordInWorkspace");
    expect(timelineService).toContain("...activeWhere");
    expect(timelineService).toContain("prisma.note.findMany");
    expect(timelineService).toContain("prisma.activity.findMany");
    expect(timelineService).toContain("prisma.emailLog.findMany");
    expect(timelineService).toContain("noteAttachmentRelationsWhere(workspaceId)");
    expect(timelineService).toContain("activityAttachmentRelationsWhere(workspaceId)");
    expect(timelineService).toContain("emailLogAttachmentRelationsWhere(workspaceId)");
    expect(timelineService).toContain("prisma.auditLog.findMany");
    expect(timelineService).toContain("Number.isFinite(time) ? time : 0");
    expect(timelineService).toContain("timelineTieRank");
  });

  it("renders a shared read-only timeline with audit formatting", () => {
    expect(recordTimeline).toContain("className=\"data-card section-spaced\"");
    expect(recordTimeline).toContain("id = \"timeline\"");
    expect(recordTimeline).toContain("id={id}");
    expect(recordTimeline).toContain("title = \"Timeline\"");
    expect(recordTimeline).toContain("No timeline activity yet.");
    expect(recordTimeline).toContain("title={emptyMessage}");
    expect(recordTimeline).toContain("formatAuditEvent(item.event)");
    expect(recordTimeline).toContain("<strong>{event.label}</strong>");
    expect(recordTimeline).toContain("Completed");
    expect(recordTimeline).toContain("formatActivityType(item.activityType)");
    expect(recordTimeline).toContain("import { ActivityDueBadge }");
    expect(recordTimeline).toContain("import { ActionGroup }");
    expect(recordTimeline).toContain("className=\"timeline-item-heading\"");
    expect(recordTimeline).toContain("<ActivityDueBadge activity={item} />");
    expect(recordTimeline).toContain("formatActivityStatus(item)");
    expect(recordTimeline).toContain("href={`/activities/${item.activityId}/edit` as Route}");
    expect(recordTimeline).toContain("aria-label={`View timeline activity ${item.title}`}");
    expect(recordTimeline).toContain("title={`View timeline activity ${item.title}`}");
    expect(recordTimeline).toContain("View activity");
    expect(recordTimeline).toContain("item.completedAt ? (");
    expect(recordTimeline).toContain("href={\"#add-activity\" as Route}");
    expect(recordTimeline).toContain("Add follow-up");
    expect(recordTimeline).toContain("Add next follow-up after timeline activity ${item.title}");
    expect(recordTimeline).toContain("const activityActionsLabel = `${item.title} timeline activity actions`");
    expect(recordTimeline).toContain('<ActionGroup className="timeline-item-actions" label={activityActionsLabel}>');
    expect(recordTimeline).toContain("const noteActionsLabel = `Note by ${item.authorName} timeline note actions`");
    expect(recordTimeline).toContain('<ActionGroup className="timeline-item-actions" label={noteActionsLabel}>');
    expect(recordTimeline).toContain("href={\"#notes\" as Route}");
    expect(recordTimeline).toContain("Review notes");
    expect(recordTimeline).toContain("Review notes for timeline note by ${item.authorName}");
    expect(timelineService).toContain("activityId: activity.id");
    expect(globalStyles).toContain(".timeline-item-heading");
    expect(recordTimeline).toContain("Added note");
    expect(recordTimeline).toContain("formatEmailTimelineLabel(item.direction)");
    expect(recordTimeline).toContain("Logged outbound email");
    expect(recordTimeline).toContain("Logged inbound email");
    expect(recordTimeline).toContain("Review email log");
    expect(recordTimeline).toContain("aria-label={`Review email log for ${item.subject}`}");
    expect(recordTimeline).toContain("title={`Review email log for ${item.subject}`}");
    expect(recordTimeline).toContain("const emailActionsLabel = `${item.subject} timeline email actions`");
    expect(recordTimeline).toContain('<ActionGroup className="timeline-item-actions" label={emailActionsLabel}>');
    expect(recordTimeline).toContain("const auditActionsLabel = `${event.label} timeline audit actions`");
    expect(recordTimeline).toContain('<ActionGroup className="timeline-item-actions" label={auditActionsLabel}>');
    expect(recordTimeline).toContain("href={\"#audit-history\" as Route}");
    expect(recordTimeline).toContain("Review audit history");
    expect(recordTimeline).toContain("aria-label={`Review audit history for ${event.label}`}");
    expect(recordTimeline).toContain("title={`Review audit history for ${event.label}`}");
    expect(globalStyles).toContain(".timeline-item-actions");
  });

  it("uses shared record panel jump navigation for workspace sections", () => {
    expect(recordSummary).toContain("import { useId, type ReactNode } from \"react\"");
    expect(recordSummary).toContain("const titleId = `${useId()}-record-summary-title`");
    expect(recordSummary).toContain("aria-labelledby={titleId}");
    expect(recordSummary).toContain("<h2 id={titleId}>{title}</h2>");
    expect(recordSummary).not.toContain("function recordSummaryTitleId");
    expect(recordSummary).not.toContain('aria-label={title}');
    expect(recordSummary).toContain("actionsLabel = \"Record workspace actions\"");
    expect(recordSummary).toContain("const resolvedActionsLabel");
    expect(recordSummary).toContain("actionsLabel === \"Record workspace actions\" ? `${title} actions` : actionsLabel");
    expect(recordSummary).toContain("import { ActionGroup }");
    expect(recordSummary).toContain("<ActionGroup className=\"record-summary-actions\" label={resolvedActionsLabel}>");
    expect(recordPanelJumpNav).toContain("export function RecordPanelJumpNav");
    expect(recordPanelJumpNav).toContain("ariaLabel = \"Record workspace panels\"");
    expect(recordPanelJumpNav).toContain("counts = {}");
    expect(recordPanelJumpNav).toContain("extraJumps = []");
    expect(recordPanelJumpNav).toContain("label = \"Workspace\"");
    expect(recordPanelJumpNav).toContain("[...defaultPanelJumps, ...extraJumps]");
    expect(recordPanelJumpNav).toContain("className=\"record-panel-jump-nav\"");
    expect(recordPanelJumpNav).toContain("<span className=\"record-panel-jump-label\">{label}</span>");
    expect(recordPanelJumpNav).toContain("<ul className=\"record-panel-jump-list\">");
    expect(recordPanelJumpNav).toContain("<li className=\"record-panel-jump-item\"");
    expect(recordPanelJumpNav).toContain("record-panel-jump-link");
    expect(recordPanelJumpNav).toContain("const linkClassName = [");
    expect(recordPanelJumpNav).toContain("count === 0 ? \"record-panel-jump-link-muted\" : null");
    expect(recordPanelJumpNav).toContain("className={linkClassName}");
    expect(recordPanelJumpNav).toContain("record-panel-jump-count");
    expect(recordPanelJumpNav).toContain("countLabel?: RecordPanelJumpCountLabel");
    expect(recordPanelJumpNav).toContain("const jumpLabel = formatJumpAriaLabel(jump.label, count, jump.countLabel)");
    expect(recordPanelJumpNav).toContain("aria-label={jumpLabel}");
    expect(recordPanelJumpNav).toContain("title={jumpLabel}");
    expect(recordPanelJumpNav).toContain("aria-hidden=\"true\"");
    expect(recordPanelJumpNav).toContain("export type RecordPanelJumpCountLabel");
    expect(recordPanelJumpNav).toContain("function countLabel");
    expect(recordPanelJumpNav).toContain("function formatJumpAriaLabel");
    expect(recordPanelJumpNav).toContain("count === 1 ? itemLabel.singular : itemLabel.plural");
    expect(recordPanelJumpNav).toContain('countLabel: countLabel("activity", "activities")');
    expect(recordPanelJumpNav).toContain('countLabel: countLabel("note", "notes")');
    expect(recordPanelJumpNav).toContain('countLabel: countLabel("custom field", "custom fields")');
    expect(recordPanelJumpNav).toContain('countLabel: countLabel("email log", "email logs")');
    expect(recordPanelJumpNav).toContain('countLabel: countLabel("timeline event", "timeline events")');
    expect(recordPanelJumpNav).toContain('countLabel: countLabel("audit event", "audit events")');
    expect(recordPanelJumpNav).toContain("countKey: \"activities\"");
    expect(recordPanelJumpNav).toContain("countKey: \"notes\"");
    expect(recordPanelJumpNav).toContain("countKey: \"customFields\"");
    expect(recordPanelJumpNav).toContain("countKey: \"emailLog\"");
    expect(recordPanelJumpNav).toContain("countKey: \"timeline\"");
    expect(recordPanelJumpNav).toContain("countKey: \"auditHistory\"");
    expect(recordPanelJumpNav).toContain("href: \"#activities\" as Route");
    expect(recordPanelJumpNav).toContain("href: \"#notes\" as Route");
    expect(recordPanelJumpNav).toContain("href: \"#custom-fields\" as Route");
    expect(recordPanelJumpNav).toContain("href: \"#email-log\" as Route");
    expect(recordPanelJumpNav).toContain("href: \"#timeline\" as Route");
    expect(recordPanelJumpNav).toContain("href: \"#audit-history\" as Route");
    expect(recordPanelJumpNav).toContain("Email");
    expect(recordPanelJumpNav).toContain("Audit");
    expect(globalStyles).toContain(".record-panel-jump-nav");
    expect(globalStyles).toContain(".record-panel-jump-label");
    expect(globalStyles).toContain(".record-panel-jump-list");
    expect(globalStyles).toContain(".record-panel-jump-item");
    expect(globalStyles).toContain(".record-panel-jump-link-muted");
    expect(globalStyles).toContain(".record-panel-jump-link-muted .record-panel-jump-count");
    expect(globalStyles).toContain("list-style: none");
    expect(globalStyles).toContain("overscroll-behavior-x: contain");
    expect(globalStyles).toContain("-webkit-overflow-scrolling: touch");
  });

  it("surfaces next-step and history context on deal detail pages", () => {
    expect(dealPage).toContain("RecordSummary");
    expect(dealPage).toContain("title=\"Deal workspace\"");
    expect(dealPage).toContain("eyebrow=\"Deal snapshot\"");
    expect(dealPage).toContain("RecordNextActivitySummary activity={nextActivity}");
    expect(dealPage).toContain("No open deal follow-up");
    expect(dealPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(dealPage).toContain('import { recordSubtitle } from "@/lib/record-subtitle"');
    expect(dealPage).toContain("subtitle={recordSubtitle([deal.stage.name, formatMoney(deal.valueCents, deal.currency), deal.organization?.name ?? formatPersonName(deal.person)])}");
    expect(dealPage).not.toContain(".filter(Boolean)\n            .join(\" · \")");
    expect(dealPage).toContain('formatPersonName(deal.person) ?? "Unnamed contact"');
    expect(dealPage).not.toContain("function formatPersonName");
    expect(dealPage).not.toContain("formatPersonNameOrNull");
    expect(personName).toContain("export function formatPersonName");
    expect(dealPage).toContain("{ label: \"Owner\", value: deal.owner?.name ?? deal.owner?.email ?? \"Unassigned\", tone: deal.owner ? \"default\" : \"muted\" }");
    expect(dealPage).toContain("{ label: \"Owner\", value: deal.owner?.name ?? deal.owner?.email ?? \"Unassigned\" }");
    expect(dealPage).toContain('emptyLabel: "No contact"');
    expect(dealPage).toContain('emptyLabel: "No organization"');
    expect(dealPage).toContain('import { InlineEmptyStateText } from "@/components/inline-empty-state-text"');
    expect(dealPage).toContain("<InlineEmptyStateText>No customer linked</InlineEmptyStateText>");
    expect(dealPage).not.toContain('"Not linked"');
    expect(dealPage).toContain("DealNextStepCard");
    expect(dealPage).toContain("dealTitle={deal.title}");
    expect(dealPage).toContain("dealTitle: string");
    expect(dealPage).toContain("const addNextActivityActionLabel = `Add next activity for ${dealTitle}`");
    expect(dealPage).toContain("aria-label={addNextActivityActionLabel}");
    expect(dealPage).toContain("title={addNextActivityActionLabel}");
    expect(dealPage).toContain("classifyDealAttention");
    expect(dealPage).toContain("dealAttentionLabel(attention)");
    expect(dealPage).toContain("EmptyState");
    expect(dealPage).toContain("deal-next-step-empty");
    expect(dealPage).toContain("No open activity is attached to this deal.");
    expect(dealPage).not.toContain("<p className=\"empty-copy\">No open activity is attached to this deal.</p>");
    expect(dealPage).toContain("ActivityDueBadge");
    expect(dealPage).toContain("formatActivityType(activity.type)");
    expect(dealPage).toContain("PanelTitleRow");
    expect(dealPage).toContain("title=\"Next Step\"");
    expect(dealPage).toContain("History Snapshot");
    expect(dealPage).toContain("title=\"History Snapshot\"");
    expect(dealPage).toContain("title=\"Stage Movement\"");
    expect(dealPage).toContain("title=\"Deal Outcome\"");
    expect(dealPage).toContain("FormIntroCallout");
    expect(dealPage).toContain("title=\"Suggested next steps\"");
    expect(dealPage).toContain("eyebrow=\"Suggested Automations\"");
    expect(dealPage).toContain("title=\"One-click next actions\"");
    expect(dealPage).not.toContain("deal-context-heading");
    expect(dealPage).toContain("RecordPanelJumpNav");
    expect(dealPage).toContain("activities: deal.activities.length");
    expect(dealPage).toContain("auditHistory: deal.auditLogs.length");
    expect(dealPage).toContain("customFields: customFields.length");
    expect(dealPage).toContain("emailLog: emailLogs.length");
    expect(dealPage).toContain("timeline: timelineItems.length");
    expect(dealPage).toContain('countLabel: { singular: "contract step", plural: "contract steps" }');
    expect(dealPage).toContain('countLabel: { singular: "line item", plural: "line items" }');
    expect(dealPage).toContain('countLabel: { singular: "quote", plural: "quotes" }');
    expect(dealPage).toContain("Open activities");
    expect(dealPage).toContain("Completed activities");
    expect(dealPage).toContain("Notes");
    expect(dealPage).toContain("Timeline events");
    expect(dealPage).toContain("title=\"Deal Timeline\"");
    expect(dealPage).toContain('recordActivitySectionCopy("dealOpen")');
    expect(dealPage).toContain('recordActivitySectionCopy("dealCompleted")');
    expect(recordActivityCopy).toContain("Open Next Steps");
    expect(recordActivityCopy).toContain("Completed Activity History");
  });

  it("adds the unified timeline to primary record detail pages while preserving separate panels", () => {
    for (const page of [dealPage, leadPage, contactPage, organizationPage]) {
      expect(page).toContain("RecordTimeline");
      expect(page).toContain("getRecordTimeline");
      expect(page).toContain("RecordPanelJumpNav");
      expect(page).toContain("counts={{");
      expect(page).toContain('formId="add-activity"');
      expect(page).toContain("NotesPanel");
      expect(page).toContain("RecordActivitiesPanel");
      expect(page).toContain("ManualEmailLogPanel");
      expect(page).toContain("AuditHistoryPanel");
    }
    for (const page of [leadPage, contactPage, organizationPage]) {
      expect(page).toContain("const emailLogCount = timelineItems.filter((item) => item.type === \"email\").length");
      expect(page).toContain("emailLog: emailLogCount");
    }
  });
});
