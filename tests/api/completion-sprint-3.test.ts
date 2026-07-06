import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildActivityFollowUpHref, formatFutureDateParam } from "@/lib/follow-up-links";

const activityForm = readFileSync(join(process.cwd(), "components/activity-form.tsx"), "utf8");
const newActivityPage = readFileSync(join(process.cwd(), "app/activities/new/page.tsx"), "utf8");
const followUpLinks = readFileSync(join(process.cwd(), "lib/follow-up-links.ts"), "utf8");
const returnTo = readFileSync(join(process.cwd(), "lib/return-to.ts"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const recordHeaderActions = readFileSync(join(process.cwd(), "components/record-header-actions.tsx"), "utf8");
const quotePage = readFileSync(join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/page.tsx"), "utf8");
const quotePanel = readFileSync(join(process.cwd(), "components/quote-drafts-panel.tsx"), "utf8");
const contractPanel = readFileSync(join(process.cwd(), "components/contract-workflow-panel.tsx"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const emailFollowUpPanel = readFileSync(join(process.cwd(), "components/email-follow-up-panel.tsx"), "utf8");
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("rapid completion sprint 3 polish", () => {
  it("adds a reusable prefilled follow-up path without a new schema", () => {
    expect(followUpLinks).toContain("buildActivityFollowUpHref");
    expect(followUpLinks).toContain("related");
    expect(followUpLinks).toContain("returnTo");
    expect(activityForm).toContain("initialAttachmentValue");
    expect(activityForm).toContain("initialDescription");
    expect(activityForm).toContain("initialDueAt");
    expect(activityForm).toContain("initialTitle");
    expect(activityForm).toContain("initialType");
    expect(newActivityPage).toContain("searchParams");
    expect(newActivityPage).toContain("parseInitialAttachmentValue");
    expect(newActivityPage).toContain("parseDueDateParam");
    expect(newActivityPage).toContain("parseReturnToHref");
    expect(returnTo).toContain("isAllowedReturnPath");
    expect(newActivityPage).toContain("redirectTo={returnHref}");
    expect(newActivityPage).toContain("cancelHref={returnHref}");
    expect(newActivityPage).toContain("We prefilled this activity from your search or record shortcut.");
    expect(schema).not.toContain("lostReason String");
  });

  it("formats deterministic future due-date prefill values", () => {
    expect(formatFutureDateParam(1, new Date("2030-01-31T18:00:00.000Z"))).toBe("2030-02-01");
    expect(formatFutureDateParam(3, new Date("2030-12-30T04:00:00.000Z"))).toBe("2031-01-02");
    const followUpUrl = new URL(
      buildActivityFollowUpHref({
        related: { type: "deal", id: "deal_123" },
        returnTo: "/deals?status=OPEN&page=2",
        title: "Follow up"
      }),
      "https://northstar.local"
    );
    expect(followUpUrl.pathname).toBe("/activities/new");
    expect(followUpUrl.searchParams.get("related")).toBe("deal:deal_123");
    expect(followUpUrl.searchParams.get("returnTo")).toBe("/deals?status=OPEN&page=2");
  });

  it("surfaces follow-up actions from core CRM and email records", () => {
    expect(recordHeaderActions).toContain("addLabel = \"Add follow-up\"");
    expect(recordHeaderActions).toContain("addLockedLabel = \"Follow-up locked\"");
    expect(recordHeaderActions).toContain("noteLockedLabel = \"Notes locked\"");
    expect(recordHeaderActions).toContain("const editLockedActionLabel = lockedRecordActionLabel(editLabel, lockedLabel, recordTitle)");
    expect(recordHeaderActions).toContain("aria-label={editLockedActionLabel}");
    expect(recordHeaderActions).toContain("title={editLockedActionLabel}");
    expect(contactPage).toContain("RecordHeaderActions");
    expect(contactPage).toContain("addHref={\"#add-activity\" as Route}");
    expect(contactPage).toContain("formId=\"add-activity\"");
    expect(organizationPage).toContain("RecordHeaderActions");
    expect(organizationPage).toContain("addHref={\"#add-activity\" as Route}");
    expect(organizationPage).toContain("formId=\"add-activity\"");
    expect(leadPage).toContain("RecordHeaderActions");
    expect(leadPage).toContain("addHref={\"#add-activity\" as Route}");
    expect(leadPage).toContain("lockedLabel={convertedLeadLockedLabel}");
    expect(leadPage).toContain("formId=\"add-activity\"");
    expect(leadPage).toContain("Linked activities, notes, and email logs will");
    expect(leadPage).toContain("move to the new deal timeline, then Northstar opens the converted deal");
    expect(quotePage).toContain("related: { type: \"deal\", id: quote.dealId }");
    expect(quotePage).toContain("returnTo: `/deals/${quote.dealId}/quotes/${quote.id}`");
    expect(emailPage).toContain("buildEmailFollowUpDraftFromEmailLog(emailLog)");
    expect(emailPage).toContain("<EmailFollowUpPanel");
    expect(emailFollowUpPanel).toContain("Nothing is created until you save this follow-up.");
    expect(emailFollowUpPanel).toContain("Create activity");
  });

  it("makes quote and contract workflows more actionable without fake document features", () => {
    expect(quotePanel).toContain("quoteLifecycleStatuses");
    expect(quotePanel).toContain("Add quote follow-up");
    expect(quotePanel).toContain("returnTo: `/deals/${dealId}`");
    expect(quotePanel).toContain("Status changes are internal tracking only");
    expect(contractPanel).toContain("Add contract follow-up");
    expect(contractPanel).toContain("returnTo: `/deals/${dealId}`");
    expect(contractPanel).toContain("Track the sales agreement path from NDA to MSA to SOW.");
    expect(contractPanel).toContain("OpenContracts templates, document storage, and e-signature integration are a future layer");
    expect(contractPanel).not.toContain("Upload");
    expect(contractPanel).not.toContain("Generate");
    expect(contractPanel).not.toContain("Sign now");
  });
});
