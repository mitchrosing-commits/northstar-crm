import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const service = [
  readFileSync(join(process.cwd(), "lib/services/contact-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/organization-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");
const contactsList = readFileSync(join(process.cwd(), "app/contacts/page.tsx"), "utf8");
const contactDetail = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const newContactPage = readFileSync(join(process.cwd(), "app/contacts/new/page.tsx"), "utf8");
const editContactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/edit/page.tsx"), "utf8");
const contactForm = readFileSync(join(process.cwd(), "components/contact-form.tsx"), "utf8");
const personName = readFileSync(join(process.cwd(), "lib/person-name.ts"), "utf8");
const organizationsList = readFileSync(join(process.cwd(), "app/organizations/page.tsx"), "utf8");
const organizationDetail = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const newOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/new/page.tsx"), "utf8");
const editOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/edit/page.tsx"), "utf8");
const organizationForm = readFileSync(join(process.cwd(), "components/organization-form.tsx"), "utf8");

describe("contact and organization create/edit behavior", () => {
  it("routes people and organization writes through validated workspace APIs", () => {
    expect(route).toContain("createPersonSchema.parse");
    expect(route).toContain("updatePersonSchema.parse");
    expect(route).toContain("createOrganizationSchema.parse");
    expect(route).toContain("updateOrganizationSchema.parse");
  });

  it("keeps write services workspace-scoped and audited", () => {
    expect(service).toContain("normalizeCreatePersonInput(data)");
    expect(service).toContain("normalizeUpdatePersonInput(data)");
    expect(service).toContain("Contact update must be an object.");
    expect(service).toContain("const input = objectInput(data)");
    expect(service).toContain("Contact relation ids must be text.");
    expect(service).toContain("personUpdateChanges(normalized, existing)");
    expect(service).toContain("normalizeCreateOrganizationInput(data)");
    expect(service).toContain("normalizeUpdateOrganizationInput(data)");
    expect(service).toContain("Organization update must be an object.");
    expect(service).toContain("function objectInput(input: unknown): Record<string, unknown>");
    expect(service).toContain("Organization relation ids must be text.");
    expect(service).toContain("organizationUpdateChanges(normalized, existing)");
    expect(service).toContain("assertRecordInWorkspace(\"organization\"");
    expect(service).toContain("assertUserInWorkspace");
    expect(service).toContain("writeAuditLog(actor, \"person.created\"");
    expect(service).toContain("writeAuditLog(actor, \"person.updated\"");
    expect(service).toContain("writeAuditLog(actor, \"organization.created\"");
    expect(service).toContain("writeAuditLog(actor, \"organization.updated\"");
  });

  it("adds contact entry points, pages, and forms", () => {
    expect(contactsList).toContain("createHref=\"/contacts/new\"");
    expect(contactDetail).toContain("editHref={`/contacts/${person.id}/edit` as Route}");
    expect(newContactPage).toContain("ContactForm");
    expect(newContactPage).toContain("searchParams");
    expect(newContactPage).toContain("const defaultEmail = firstSearchParam(resolvedSearchParams?.email)");
    expect(newContactPage).toContain("const defaultName = firstSearchParam(resolvedSearchParams?.name)");
    expect(newContactPage).toContain("const returnTo = leadReturnToParam(resolvedSearchParams?.returnTo)");
    expect(newContactPage).toContain("defaultEmail={defaultEmail}");
    expect(newContactPage).toContain("defaultName={defaultName}");
    expect(newContactPage).toContain("const hasPrefill = Boolean(defaultEmail || defaultName || defaultOrganizationId)");
    expect(newContactPage).toContain("We prefilled this contact from your search or related-record shortcut.");
    expect(newContactPage).toContain("Northstar will return to the lead form with the contact selected.");
    expect(newContactPage).toContain("returnTo={returnTo ? { href: returnTo, paramName: \"personId\" } : undefined}");
    expect(newContactPage).toContain("defaultOrganizationId={organizationOptions.some((organization) => organization.id === defaultOrganizationId) ? defaultOrganizationId : undefined}");
    expect(editContactPage).toContain("getPerson(actor, personId)");
    expect(contactForm).toContain("/api/v1/workspaces/${workspaceId}/people");
    expect(contactForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, contact.id)");
    expect(contactForm).toContain("`/contacts/${contact.id}`");
    expect(contactForm).toContain("organizationId");
    expect(contactForm).toContain("ownerId");
    expect(contactForm).toContain("defaultEmail?: string");
    expect(contactForm).toContain("defaultName?: string");
    expect(contactForm).toContain("defaultOrganizationId?: string");
    expect(contactForm).toContain("prefillNotice?: string");
    expect(contactForm).toContain("FormPrefillNotice");
    expect(contactForm).toContain("<FormPrefillNotice>{prefillNotice}</FormPrefillNotice>");
    expect(contactForm).toContain("initialContact?.organizationId ?? defaultOrganizationId ?? \"\"");
    expect(contactForm).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(contactForm).toContain("return formatPersonName(contact) ?? \"\"");
    expect(contactForm).not.toContain("[contact.firstName, contact.lastName].filter(Boolean).join(\" \")");
    expect(personName).toContain("export function formatPersonName");
  });

  it("adds organization entry points, pages, and forms", () => {
    expect(organizationsList).toContain("createHref=\"/organizations/new\"");
    expect(organizationDetail).toContain("editHref={`/organizations/${organization.id}/edit` as Route}");
    expect(newOrganizationPage).toContain("OrganizationForm");
    expect(newOrganizationPage).toContain("searchParams?: Promise<{ name?: string; returnTo?: string }>");
    expect(newOrganizationPage).toContain("const defaultName = firstSearchParam(resolvedSearchParams?.name)");
    expect(newOrganizationPage).toContain("const returnTo = leadReturnToParam(resolvedSearchParams?.returnTo)");
    expect(newOrganizationPage).toContain("defaultName={defaultName}");
    expect(newOrganizationPage).toContain("const hasPrefill = Boolean(defaultName)");
    expect(newOrganizationPage).toContain("We prefilled this organization from your search shortcut.");
    expect(newOrganizationPage).toContain("Northstar will return to the lead form with the company selected.");
    expect(newOrganizationPage).toContain("returnTo={returnTo ? { href: returnTo, paramName: \"organizationId\" } : undefined}");
    expect(editOrganizationPage).toContain("getOrganization(actor, organizationId)");
    expect(organizationForm).toContain("/api/v1/workspaces/${workspaceId}/organizations");
    expect(organizationForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, organization.id)");
    expect(organizationForm).toContain("`/organizations/${organization.id}`");
    expect(organizationForm).toContain("domain");
    expect(organizationForm).toContain("ownerId");
    expect(organizationForm).toContain("defaultName?: string");
    expect(organizationForm).toContain("prefillNotice?: string");
    expect(organizationForm).toContain("FormPrefillNotice");
    expect(organizationForm).toContain("<FormPrefillNotice>{prefillNotice}</FormPrefillNotice>");
    expect(organizationForm).toContain("initialOrganization?.name ?? defaultName ?? \"\"");
  });
});
