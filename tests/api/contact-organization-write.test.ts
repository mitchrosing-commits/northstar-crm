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
    expect(service).toContain("assertRecordInWorkspace(\"organization\"");
    expect(service).toContain("assertUserInWorkspace");
    expect(service).toContain("writeAuditLog(actor, \"person.created\"");
    expect(service).toContain("writeAuditLog(actor, \"person.updated\"");
    expect(service).toContain("writeAuditLog(actor, \"organization.created\"");
    expect(service).toContain("writeAuditLog(actor, \"organization.updated\"");
  });

  it("adds contact entry points, pages, and forms", () => {
    expect(contactsList).toContain("href=\"/contacts/new\"");
    expect(contactDetail).toContain("href={`/contacts/${person.id}/edit`}");
    expect(newContactPage).toContain("ContactForm");
    expect(newContactPage).toContain("searchParams");
    expect(newContactPage).toContain("defaultEmail={firstSearchParam(resolvedSearchParams?.email)}");
    expect(newContactPage).toContain("defaultName={firstSearchParam(resolvedSearchParams?.name)}");
    expect(editContactPage).toContain("getPerson(actor, personId)");
    expect(contactForm).toContain("/api/v1/workspaces/${workspaceId}/people");
    expect(contactForm).toContain("router.push(`/contacts/${contact.id}`)");
    expect(contactForm).toContain("organizationId");
    expect(contactForm).toContain("ownerId");
    expect(contactForm).toContain("defaultEmail?: string");
    expect(contactForm).toContain("defaultName?: string");
  });

  it("adds organization entry points, pages, and forms", () => {
    expect(organizationsList).toContain("href=\"/organizations/new\"");
    expect(organizationDetail).toContain("href={`/organizations/${organization.id}/edit`}");
    expect(newOrganizationPage).toContain("OrganizationForm");
    expect(editOrganizationPage).toContain("getOrganization(actor, organizationId)");
    expect(organizationForm).toContain("/api/v1/workspaces/${workspaceId}/organizations");
    expect(organizationForm).toContain("router.push(`/organizations/${organization.id}`)");
    expect(organizationForm).toContain("domain");
    expect(organizationForm).toContain("ownerId");
  });
});
