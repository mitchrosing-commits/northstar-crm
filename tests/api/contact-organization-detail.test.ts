import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = [
  readFileSync(join(process.cwd(), "lib/services/contact-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/organization-service.ts"), "utf8")
].join("\n");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const contactsList = readFileSync(join(process.cwd(), "app/contacts/page.tsx"), "utf8");
const organizationsList = readFileSync(join(process.cwd(), "app/organizations/page.tsx"), "utf8");
const dealDetail = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const activityList = readFileSync(join(process.cwd(), "components/activity-list.tsx"), "utf8");

describe("contact and organization detail pages", () => {
  it("uses existing workspace-scoped person and organization services with related records", () => {
    expect(service).toContain("export async function getPerson");
    expect(service).toContain("export async function getOrganization");
    expect(service).toContain("deals: { where: activeWhere");
    expect(service).toContain("activities: { where: activeWhere");
    expect(service).toContain("notes: { where: activeWhere");
    expect(service).toContain("entityType: \"Person\"");
    expect(service).toContain("entityType: \"Organization\"");
  });

  it("adds read-only detail pages with not-found handling", () => {
    expect(contactPage).toContain("getPerson(actor, personId)");
    expect(contactPage).toContain("notFound()");
    expect(contactPage).toContain("Linked Deals");
    expect(contactPage).toContain("No deals are linked to this contact.");
    expect(contactPage).toContain("AuditHistoryPanel");
    expect(organizationPage).toContain("getOrganization(actor, organizationId)");
    expect(organizationPage).toContain("notFound()");
    expect(organizationPage).toContain("No people are linked to this organization.");
    expect(organizationPage).toContain("AuditHistoryPanel");
  });

  it("links people and organizations from existing CRM surfaces", () => {
    expect(contactsList).toContain("href={`/contacts/${person.id}`}");
    expect(contactsList).toContain("href={`/organizations/${person.organization.id}`}");
    expect(organizationsList).toContain("href={`/organizations/${organization.id}`}");
    expect(dealDetail).toContain("href={`/contacts/${deal.person.id}`}");
    expect(dealDetail).toContain("href={`/organizations/${deal.organization.id}`}");
    expect(activityList).toContain("href={`/contacts/${activity.person.id}`}");
    expect(activityList).toContain("href={`/organizations/${activity.organization.id}`}");
  });
});
