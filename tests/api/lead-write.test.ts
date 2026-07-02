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
const personName = readFileSync(join(process.cwd(), "lib/person-name.ts"), "utf8");

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
    expect(service).toContain("normalizeCreateLeadInput(data)");
    expect(service).toContain("normalizeUpdateLeadInput(data)");
    expect(service).toContain("Lead update must be an object.");
    expect(service).toContain("Array.isArray(data)");
    expect(service).toContain("Lead relation ids must be text.");
    expect(service).toContain("Object.keys(normalized).length === 0 || !leadUpdateChanges(normalized, existing)");
    expect(service).toContain("leadUpdateChanges(");
    expect(service).toContain("data: { ...normalized, workspaceId: actor.workspaceId }");
    expect(service).toContain("writeAuditLog(actor, \"lead.created\"");
    expect(service).toContain("writeAuditLog(actor, \"lead.updated\"");
    expect(service).toContain("LEAD_LOCKED");
    expect(service).toContain("normalizeEditableLeadStatus(input.status)");
    expect(service).toContain("Lead status must be NEW, QUALIFIED, or DISQUALIFIED.");
    expect(service).toContain("Use lead conversion to mark a lead converted.");
  });

  it("adds lead entry points, pages, and form redirects", () => {
    expect(leadsList).toContain("createHref=\"/leads/new\"");
    expect(leadDetail).toContain("editHref={lead.status !== \"CONVERTED\" ? (`/leads/${lead.id}/edit` as Route) : undefined}");
    expect(newLeadPage).toContain("LeadForm");
    expect(newLeadPage).toContain("searchParams");
    expect(newLeadPage).toContain("const defaultSource = firstSearchParam(resolvedSearchParams?.source)");
    expect(newLeadPage).toContain("const defaultTitle = firstSearchParam(resolvedSearchParams?.title)");
    expect(newLeadPage).toContain("defaultSource={defaultSource}");
    expect(newLeadPage).toContain("defaultTitle={defaultTitle}");
    expect(newLeadPage).toContain("const hasPrefill = Boolean(defaultSource || defaultTitle)");
    expect(newLeadPage).toContain("We prefilled this lead from your search shortcut.");
    expect(newLeadPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(newLeadPage).toContain('formatPersonName(person) ?? "Unnamed contact"');
    expect(newLeadPage).not.toContain("function formatPersonName");
    expect(editLeadPage).toContain("Converted leads are locked");
    expect(editLeadPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(editLeadPage).toContain('formatPersonName(person) ?? "Unnamed contact"');
    expect(editLeadPage).not.toContain("function formatPersonName");
    expect(personName).toContain("export function formatPersonName");
    expect(form).toContain("/api/v1/workspaces/${workspaceId}/leads");
    expect(form).toContain("router.push(`/leads/${lead.id}`)");
    expect(form).toContain("QUALIFIED");
    expect(form).toContain("DISQUALIFIED");
    expect(form).toContain("defaultSource?: string");
    expect(form).toContain("defaultTitle?: string");
    expect(form).toContain("prefillNotice?: string");
    expect(form).toContain("FormPrefillNotice");
    expect(form).toContain("<FormPrefillNotice>{prefillNotice}</FormPrefillNotice>");
  });
});
