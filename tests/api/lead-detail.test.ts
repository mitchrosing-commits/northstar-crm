import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(join(process.cwd(), "lib/services/lead-service.ts"), "utf8");
const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
const leadList = readFileSync(join(process.cwd(), "app/leads/page.tsx"), "utf8");
const leadDetail = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const auditHistoryPanel = readFileSync(join(process.cwd(), "components/audit-history-panel.tsx"), "utf8");

describe("lead list and detail behavior", () => {
  it("adds a workspace-scoped getLead service and read route", () => {
    expect(service).toContain("export async function getLead");
    expect(service).toContain("where: { id: leadId, workspaceId: actor.workspaceId");
    expect(service).toContain("entityType: \"Lead\"");
    expect(route).toContain("getLead(actor, idOrNested)");
  });

  it("adds a leads nav item and list page with linked CRM records", () => {
    expect(appShell).toContain("href: \"/leads\"");
    expect(leadList).toContain("listLeads");
    expect(leadList).toContain("href={`/leads/${lead.id}`}");
    expect(leadList).toContain("href={`/contacts/${lead.person.id}`}");
    expect(leadList).toContain("href={`/organizations/${lead.organization.id}`}");
  });

  it("adds read-only lead detail with conversion readiness and not-found handling", () => {
    expect(leadDetail).toContain("getLead(actor, leadId)");
    expect(leadDetail).toContain("notFound()");
    expect(leadDetail).toContain("Convert to Deal");
    expect(leadDetail).toContain("LeadConversionForm");
    expect(leadDetail).toContain("AuditHistoryPanel");
    expect(auditHistoryPanel).toContain("Audit History");
    expect(leadDetail).toContain("No activities are linked to this lead.");
  });
});
