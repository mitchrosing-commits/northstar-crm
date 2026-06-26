import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatFutureDateParam } from "@/lib/follow-up-links";

const activityForm = readFileSync(join(process.cwd(), "components/activity-form.tsx"), "utf8");
const newActivityPage = readFileSync(join(process.cwd(), "app/activities/new/page.tsx"), "utf8");
const followUpLinks = readFileSync(join(process.cwd(), "lib/follow-up-links.ts"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const quotePage = readFileSync(join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/page.tsx"), "utf8");
const quotePanel = readFileSync(join(process.cwd(), "components/quote-drafts-panel.tsx"), "utf8");
const contractPanel = readFileSync(join(process.cwd(), "components/contract-workflow-panel.tsx"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("rapid completion sprint 3 polish", () => {
  it("adds a reusable prefilled follow-up path without a new schema", () => {
    expect(followUpLinks).toContain("buildActivityFollowUpHref");
    expect(followUpLinks).toContain("related");
    expect(activityForm).toContain("initialAttachmentValue");
    expect(activityForm).toContain("initialDescription");
    expect(activityForm).toContain("initialDueAt");
    expect(activityForm).toContain("initialTitle");
    expect(activityForm).toContain("initialType");
    expect(newActivityPage).toContain("searchParams");
    expect(newActivityPage).toContain("parseInitialAttachmentValue");
    expect(newActivityPage).toContain("parseDueDateParam");
    expect(newActivityPage).toContain("We prefilled this activity from the record you were viewing");
    expect(schema).not.toContain("lostReason String");
  });

  it("formats deterministic future due-date prefill values", () => {
    expect(formatFutureDateParam(1, new Date("2030-01-31T18:00:00.000Z"))).toBe("2030-02-01");
    expect(formatFutureDateParam(3, new Date("2030-12-30T04:00:00.000Z"))).toBe("2031-01-02");
  });

  it("surfaces follow-up actions from core CRM and email records", () => {
    expect(contactPage).toContain("Add follow-up");
    expect(contactPage).toContain("related: { type: \"person\", id: person.id }");
    expect(organizationPage).toContain("related: { type: \"organization\", id: organization.id }");
    expect(leadPage).toContain("related: { type: \"lead\", id: lead.id }");
    expect(leadPage).toContain("new deal timeline, then Northstar opens the converted deal");
    expect(quotePage).toContain("related: { type: \"deal\", id: quote.dealId }");
    expect(emailPage).toContain("emailLogFollowUpHref");
    expect(emailPage).toContain("type: \"EMAIL\"");
  });

  it("makes quote and contract workflows more actionable without fake document features", () => {
    expect(quotePanel).toContain("quoteLifecycleStatuses");
    expect(quotePanel).toContain("Add quote follow-up");
    expect(quotePanel).toContain("Status changes are internal tracking only");
    expect(contractPanel).toContain("Add contract follow-up");
    expect(contractPanel).toContain("Track whether NDA, MSA, and SOW are requested, sent, signed, or blocked.");
    expect(contractPanel).toContain("Document generation and e-signature can be added later.");
    expect(contractPanel).not.toContain("Upload");
    expect(contractPanel).not.toContain("Generate");
    expect(contractPanel).not.toContain("Sign now");
  });
});
