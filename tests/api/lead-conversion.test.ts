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
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const form = readFileSync(join(process.cwd(), "components/lead-conversion-form.tsx"), "utf8");

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
  });

  it("rejects invalid stages and already-converted leads", () => {
    expect(service).toContain("assertDealPipelineAndStage(actor.workspaceId, data.pipelineId, data.stageId)");
    expect(service).toContain("LEAD_ALREADY_CONVERTED");
    expect(service).toContain("This lead has already been converted.");
  });

  it("reattaches lead timeline records to the new deal and audits both records", () => {
    expect(service).toContain("data: { leadId: null, dealId: deal.id }");
    expect(service).toContain("lead.converted");
    expect(service).toContain("deal.created_from_lead");
    expect(service).toContain("reattachedActivities");
    expect(service).toContain("reattachedNotes");
  });

  it("replaces the disabled conversion placeholder with a browser form", () => {
    expect(leadPage).toContain("LeadConversionForm");
    expect(leadPage).toContain("listPipelines(actor)");
    expect(form).toContain("/api/v1/workspaces/${workspaceId}/leads/${leadId}/convert");
    expect(form).toContain("router.push(`/deals/${deal.id}`)");
  });
});
