import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const service = [
  readFileSync(join(process.cwd(), "lib/services/lead-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");
const leadsList = readFileSync(join(process.cwd(), "app/leads/page.tsx"), "utf8");
const leadDetail = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const newLeadPage = readFileSync(join(process.cwd(), "app/leads/new/page.tsx"), "utf8");
const editLeadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/edit/page.tsx"), "utf8");
const form = readFileSync(join(process.cwd(), "components/lead-form.tsx"), "utf8");

describe("lead create and update behavior", () => {
  it("routes lead create and update through validated workspace APIs", () => {
    expect(route).toContain("createLeadSchema.parse");
    expect(route).toContain("updateLeadSchema.parse");
    expect(route).toContain("createLead(actor");
    expect(route).toContain("updateLead(actor");
  });

  it("keeps lead writes workspace-scoped, audited, and conversion-safe", () => {
    expect(service).toContain("export async function updateLead");
    expect(service).toContain("assertUserInWorkspace");
    expect(service).toContain("assertRecordInWorkspace(\"person\"");
    expect(service).toContain("assertRecordInWorkspace(\"organization\"");
    expect(service).toContain("writeAuditLog(actor, \"lead.created\"");
    expect(service).toContain("writeAuditLog(actor, \"lead.updated\"");
    expect(service).toContain("LEAD_LOCKED");
    expect(service).toContain("Use lead conversion to mark a lead converted.");
  });

  it("adds lead entry points, pages, and form redirects", () => {
    expect(leadsList).toContain("href=\"/leads/new\"");
    expect(leadDetail).toContain("href={`/leads/${lead.id}/edit`}");
    expect(newLeadPage).toContain("LeadForm");
    expect(newLeadPage).toContain("searchParams");
    expect(newLeadPage).toContain("defaultSource={firstSearchParam(resolvedSearchParams?.source)}");
    expect(newLeadPage).toContain("defaultTitle={firstSearchParam(resolvedSearchParams?.title)}");
    expect(editLeadPage).toContain("Converted leads are locked");
    expect(form).toContain("/api/v1/workspaces/${workspaceId}/leads");
    expect(form).toContain("router.push(`/leads/${lead.id}`)");
    expect(form).toContain("QUALIFIED");
    expect(form).toContain("DISQUALIFIED");
    expect(form).toContain("defaultSource?: string");
    expect(form).toContain("defaultTitle?: string");
  });
});
