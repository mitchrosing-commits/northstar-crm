import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = [
  readFileSync(join(process.cwd(), "lib/services/lead-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");
const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const validator = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const openapi = readFileSync(join(process.cwd(), "docs/openapi.yaml"), "utf8");
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const form = readFileSync(join(process.cwd(), "components/lead-conversion-form.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("lead conversion behavior", () => {
  it("routes conversion through a validated workspace-scoped endpoint", () => {
    expect(route).toContain("nestedResource === \"convert\"");
    expect(route).toContain("convertLeadSchema.parse");
    expect(route).toContain("convertLeadToDeal(actor, idOrNested");
    expect(validator).toContain("export const convertLeadSchema");
  });

  it("creates a deal transactionally from a lead and marks the lead converted", () => {
    expect(service).toContain("export async function convertLeadToDeal");
    expect(service).toContain("prisma.$transaction");
    expect(service).toContain("tx.deal.create");
    expect(service).toContain("data: { status: \"CONVERTED\" }");
    expect(service).toContain("ownerId: lead.ownerId");
    expect(service).toContain("personId: lead.personId");
    expect(service).toContain("organizationId: lead.organizationId");
    expect(service).toContain("const normalized = normalizeConvertLeadInput(data)");
    expect(service).toContain("title: normalizeConvertedDealTitle(input.title)");
    expect(service).toContain("title: normalized.title || lead.title");
    expect(service).toContain("Converted deal title must be text.");
  });

  it("rejects invalid stages and already-converted leads", () => {
    expect(service).toContain("assertDealPipelineAndStage(actor.workspaceId, normalized.pipelineId, normalized.stageId)");
    expect(service).toContain("LEAD_ALREADY_CONVERTED");
    expect(service).toContain("This lead has already been converted.");
  });

  it("keeps the OpenAPI lead input contract honest about conversion-only status", () => {
    expect(openapi).toContain("enum: [NEW, QUALIFIED, DISQUALIFIED]");
    expect(openapi).toContain("Use the lead conversion endpoint to move a lead to CONVERTED.");
    expect(openapi).not.toContain("enum: [NEW, QUALIFIED, DISQUALIFIED, CONVERTED]");
  });

  it("reattaches lead timeline records to the new deal and audits both records", () => {
    expect(service).toContain("data: { leadId: null, dealId: deal.id }");
    expect(service).toContain("lead.converted");
    expect(service).toContain("deal.created_from_lead");
    expect(service).toContain("reattachedActivities");
    expect(service).toContain("reattachedNotes");
    expect(service).toContain("reattachedEmailLogs");
    expect(service).toContain("tx.emailLog.updateMany");
  });

  it("replaces the disabled conversion placeholder with a browser form", () => {
    expect(leadPage).toContain("LeadConversionForm");
    expect(leadPage).toContain("listPipelines(actor)");
    expect(leadPage).toContain("jumps={[");
    expect(leadPage).toContain('{ href: "#overview" as Route, label: "Overview" }');
    expect(leadPage).toContain('{ href: "#convert-lead" as Route, label: "Conversion" }');
    expect(leadPage).toContain("activities: lead.activities.length");
    expect(leadPage).toContain("id=\"convert-lead\"");
    expect(leadPage).toContain("<PanelTitleRow title=\"Convert to Deal\" />");
    expect(leadPage).not.toContain("<h2 className=\"panel-title\">Convert to Deal</h2>");
    expect(leadPage).toContain("FormIntroCallout");
    expect(leadPage).toContain("title=\"Conversion path\"");
    expect(leadPage).toContain("title=\"Relationship check\"");
    expect(leadPage).toContain("className=\"lead-conversion-note\"");
    expect(leadPage).toContain("<div className=\"section-spaced\">");
    expect(leadPage).not.toContain("<p className=\"empty-copy lead-conversion-note\">");
    expect(leadPage).not.toContain("style={{ marginTop: 8 }}");
    expect(globalStyles).toContain(".lead-conversion-note");
    expect(form).toContain("/api/v1/workspaces/${workspaceId}/leads/${leadId}/convert");
    expect(form).toContain("router.push(`/deals/${deal.id}`)");
    expect(form).toContain("import { FormFieldLabel }");
    expect(form).toContain("<FormFieldLabel required>Pipeline</FormFieldLabel>");
    expect(form).toContain("<FormFieldLabel required>Stage</FormFieldLabel>");
    expect(form).toContain("<FormFieldLabel>Deal title</FormFieldLabel>");
  });

  it("uses shared locked and empty-state patterns for unavailable conversion states", () => {
    expect(form).toContain("LockedPanelNotice");
    expect(form).toContain("title=\"Lead converted\"");
    expect(form).toContain("EmptyState");
    expect(form).toContain("title=\"No pipeline available\"");
    expect(form).toContain("title=\"No stage available\"");
    expect(form).toContain("lead-conversion-empty");
    expect(form).not.toContain("return <p className=\"empty-copy\">This lead has already been converted.</p>;");
    expect(form).not.toContain("return <p className=\"empty-copy\">Create or seed a pipeline before converting leads.</p>;");
  });
});
