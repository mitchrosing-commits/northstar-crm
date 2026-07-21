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
const newContactPage = readFileSync(join(process.cwd(), "app/contacts/new/page.tsx"), "utf8");
const contactForm = readFileSync(join(process.cwd(), "components/contact-form.tsx"), "utf8");
const newOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/new/page.tsx"), "utf8");
const organizationForm = readFileSync(join(process.cwd(), "components/organization-form.tsx"), "utf8");
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
    expect(newLeadPage).toContain("const requestedPersonId = firstSearchParam(resolvedSearchParams?.personId)");
    expect(newLeadPage).toContain("const requestedOrganizationId = firstSearchParam(resolvedSearchParams?.organizationId)");
    expect(newLeadPage).toContain("const returnHref = parseReturnToHref(resolvedSearchParams?.returnTo, \"/leads\")");
    expect(newLeadPage).toContain("const defaultPersonId = people.some((person) => person.id === requestedPersonId) ? requestedPersonId : undefined;");
    expect(newLeadPage).toContain("const defaultOrganizationId = organizations.some((organization) => organization.id === requestedOrganizationId) ? requestedOrganizationId : undefined;");
    expect(newLeadPage).toContain("defaultSource={defaultSource}");
    expect(newLeadPage).toContain("defaultTitle={defaultTitle}");
    expect(newLeadPage).toContain("defaultPersonId={defaultPersonId}");
    expect(newLeadPage).toContain("defaultOrganizationId={defaultOrganizationId}");
    expect(newLeadPage).toContain("leadStatusSearchParam");
    expect(newLeadPage).toContain("We linked the newly created record to this lead draft.");
    expect(newLeadPage).toContain("We prefilled this lead from your search shortcut.");
    expect(newLeadPage).toContain("Create this lead, then Northstar will return to your activity draft with the lead selected.");
    expect(newLeadPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(newLeadPage).toContain('formatPersonName(person) ?? "Unnamed contact"');
    expect(newLeadPage).not.toContain("function formatPersonName");
    expect(editLeadPage).toContain("Converted leads are locked");
    expect(editLeadPage).toContain("searchParams?: Promise<{ organizationId?: string; personId?: string }>");
    expect(editLeadPage).toContain("const selectedPersonId = people.some((person) => person.id === requestedPersonId) ? requestedPersonId ?? null : lead.personId;");
    expect(editLeadPage).toContain("const selectedOrganizationId = organizations.some((organization) => organization.id === requestedOrganizationId)");
    expect(editLeadPage).toContain("We selected the newly created related record. Save changes to attach it to this lead.");
    expect(editLeadPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(editLeadPage).toContain('formatPersonName(person) ?? "Unnamed contact"');
    expect(editLeadPage).not.toContain("function formatPersonName");
    expect(personName).toContain("export function formatPersonName");
    expect(form).toContain("/api/v1/workspaces/${workspaceId}/leads");
    expect(form).toContain("router.push((mode === \"create\" && returnTo ? appendReturnParam(returnTo.href, returnTo.paramName, lead.id) : `/leads/${lead.id}`) as Route)");
    expect(form).toContain("QUALIFIED");
    expect(form).toContain("DISQUALIFIED");
    expect(form).toContain("defaultSource?: string");
    expect(form).toContain("defaultPersonId?: string");
    expect(form).toContain("defaultOrganizationId?: string");
    expect(form).toContain("defaultStatus?: LeadStatus");
    expect(form).toContain("defaultTitle?: string");
    expect(form).toContain("prefillNotice?: string");
    expect(form).toContain("returnTo?: {");
    expect(form).toContain("paramName: \"leadId\";");
    expect(form).toContain("FormPrefillNotice");
    expect(form).toContain("<FormPrefillNotice>{prefillNotice}</FormPrefillNotice>");
    expect(form).toContain("buildLeadReturnTo");
    expect(form).toContain("relatedRecordCreateHref(\"/contacts/new\"");
    expect(form).toContain("relatedRecordCreateHref(\"/organizations/new\"");
    expect(form).toContain("Create contact");
    expect(form).toContain("Create organization");
    expect(form).toContain("returnTo: leadReturnTo");
    expect(newContactPage).toContain("leadOrActivityReturnToParam");
    expect(newContactPage).toContain("returnTo={returnTo ? { href: returnTo, paramName: \"personId\" } : undefined}");
    expect(newContactPage).toContain("Northstar will return to the source form with the contact selected.");
    expect(contactForm).toContain("returnTo?:");
    expect(contactForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, contact.id)");
    expect(newOrganizationPage).toContain("leadOrActivityReturnToParam");
    expect(newOrganizationPage).toContain("returnTo={returnTo ? { href: returnTo, paramName: \"organizationId\" } : undefined}");
    expect(newOrganizationPage).toContain("Northstar will return to the source form with the company selected.");
    expect(organizationForm).toContain("returnTo?:");
    expect(organizationForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, organization.id)");
  });
});
