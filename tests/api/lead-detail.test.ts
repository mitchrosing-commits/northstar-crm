import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(join(process.cwd(), "lib/services/lead-service.ts"), "utf8");
const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const leadList = readFileSync(join(process.cwd(), "app/leads/page.tsx"), "utf8");
const leadDetail = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const personName = readFileSync(join(process.cwd(), "lib/person-name.ts"), "utf8");
const auditHistoryPanel = readFileSync(join(process.cwd(), "components/audit-history-panel.tsx"), "utf8");
const recordActivityCopy = readFileSync(join(process.cwd(), "lib/record-activity-copy.ts"), "utf8");

describe("lead list and detail behavior", () => {
  it("adds a workspace-scoped getLead service and read route", () => {
    expect(service).toContain("export async function getLead");
    expect(service).toContain("where: { id: leadId, workspaceId: actor.workspaceId");
    expect(service).toContain("entityType: \"Lead\"");
    expect(route).toContain("getLead(actor, idOrNested)");
  });

  it("adds a leads nav item and list page with linked CRM records", () => {
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(navigation).toContain("href: \"/leads\"");
    expect(leadList).toContain("listLeads");
    expect(leadList).toContain("href={`/leads/${lead.id}`}");
    expect(leadList).toContain("TableLinkedRecordCell");
    expect(leadList).toContain("href={lead.person ? `/contacts/${lead.person.id}` : undefined}");
    expect(leadList).toContain("href={lead.organization ? `/organizations/${lead.organization.id}` : undefined}");
  });

  it("adds read-only lead detail with conversion readiness and not-found handling", () => {
    expect(leadDetail).toContain("getLead(actor, leadId)");
    expect(leadDetail).toContain("notFound()");
    expect(leadDetail).toContain("getNextOpenActivity(lead.activities)");
    expect(leadDetail).toContain("RecordNextActivitySummary activity={nextActivity}");
    expect(leadDetail).toContain("Next follow-up");
    expect(leadDetail).toContain("No open lead follow-up");
    expect(leadDetail).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(leadDetail).toContain('import { recordSubtitle } from "@/lib/record-subtitle"');
    expect(leadDetail).toContain("subtitle={recordSubtitle([lead.source, lead.owner?.name ?? lead.owner?.email, lead.organization?.name ?? formatPersonName(lead.person)])}");
    expect(leadDetail).not.toContain(".filter(Boolean)\n            .join(\" · \")");
    expect(leadDetail).toContain('formatPersonName(lead.person) ?? "Unnamed contact"');
    expect(leadDetail).not.toContain("function formatPersonName");
    expect(leadDetail).not.toContain("formatPersonNameOrNull");
    expect(personName).toContain("export function formatPersonName");
    expect(leadDetail).toContain("{ label: \"Owner\", value: lead.owner?.name ?? lead.owner?.email ?? \"Unassigned\", tone: lead.owner ? \"default\" : \"muted\" }");
    expect(leadDetail).toContain('{ emptyLabel: "No source", label: "Source", value: lead.source }');
    expect(leadDetail).toContain('emptyLabel: "No contact"');
    expect(leadDetail).toContain('emptyLabel: "No organization"');
    expect(leadDetail).not.toContain('lead.source ?? "None"');
    expect(leadDetail).toContain("Convert to Deal");
    expect(leadDetail).toContain("PanelTitleRow");
    expect(leadDetail).toContain("eyebrow=\"Suggested Automation\"");
    expect(leadDetail).toContain("title=\"First outreach\"");
    expect(leadDetail).toContain("title=\"Suggested next step\"");
    expect(leadDetail).toContain("Create a first outreach activity for this lead.");
    expect(leadDetail).not.toContain("<h2 className=\"panel-title\">First outreach</h2>");
    expect(leadDetail).not.toContain("<p className=\"empty-copy\">\n            Create a first outreach activity for this lead.");
    expect(leadDetail).toContain("extraJumps={[{ href: \"#convert-lead\" as Route, label: \"Conversion\" }]}");
    expect(leadDetail).toContain("activities: lead.activities.length");
    expect(leadDetail).toContain("customFields: customFields.length");
    expect(leadDetail).toContain("notes: lead.notes.length");
    expect(leadDetail).toContain("timeline: timelineItems.length");
    expect(leadDetail).toContain("id=\"convert-lead\"");
    expect(leadDetail).toContain("LeadConversionForm");
    expect(leadDetail).toContain("AuditHistoryPanel");
    expect(auditHistoryPanel).toContain("Audit History");
    expect(leadDetail).toContain('recordActivitySectionCopy("lead")');
    expect(recordActivityCopy).toContain("No activities are linked to this lead.");
  });
});
