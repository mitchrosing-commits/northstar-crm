import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const dealForm = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");
const leadForm = readFileSync(join(process.cwd(), "components/lead-form.tsx"), "utf8");
const contactForm = readFileSync(join(process.cwd(), "components/contact-form.tsx"), "utf8");
const organizationForm = readFileSync(join(process.cwd(), "components/organization-form.tsx"), "utf8");
const activityForm = readFileSync(join(process.cwd(), "components/activity-form.tsx"), "utf8");
const activityEditForm = readFileSync(join(process.cwd(), "components/activity-edit-form.tsx"), "utf8");
const formRelatedRecordCallout = readFileSync(
  join(process.cwd(), "components/form-related-record-callout.tsx"),
  "utf8"
);
const formIntroCallout = readFileSync(join(process.cwd(), "components/form-intro-callout.tsx"), "utf8");
const ownerAssignmentHint = readFileSync(join(process.cwd(), "components/owner-assignment-hint.tsx"), "utf8");
const newDealPage = readFileSync(join(process.cwd(), "app/deals/new/page.tsx"), "utf8");
const newLeadPage = readFileSync(join(process.cwd(), "app/leads/new/page.tsx"), "utf8");
const newContactPage = readFileSync(join(process.cwd(), "app/contacts/new/page.tsx"), "utf8");
const newOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/new/page.tsx"), "utf8");
const newActivityPage = readFileSync(join(process.cwd(), "app/activities/new/page.tsx"), "utf8");

describe("owner assignment UX", () => {
  it("defaults create forms to the current workspace user when available", () => {
    expect(newDealPage).toContain("defaultOwnerId={actorUserId}");
    expect(newLeadPage).toContain("const defaultOwnerId = owners.some((owner) => owner.id === requestedOwnerId) ? requestedOwnerId : actorUserId;");
    expect(newLeadPage).toContain("defaultOwnerId={defaultOwnerId}");
    expect(newContactPage).toContain("defaultOwnerId={actorUserId}");
    expect(newOrganizationPage).toContain("defaultOwnerId={actorUserId}");
    expect(newActivityPage).toContain("defaultOwnerId={actorUserId}");

    for (const form of [dealForm, leadForm, contactForm, organizationForm]) {
      expect(form).toContain("defaultOwnerId?: string");
      expect(form).toContain("mode === \"create\" ? defaultOwnerId");
      expect(form).toContain("owners.length === 1 ? owners[0]?.id");
      expect(form).toContain("FormIntroCallout");
    }
    expect(formIntroCallout).toContain("form-intro-copy");
    for (const form of [dealForm, leadForm]) {
      expect(form).toContain("FormRelatedRecordCallout");
    }
    expect(formRelatedRecordCallout).toContain("form-related-callout");
    expect(formRelatedRecordCallout).toContain("form-callout-copy");
  });

  it("keeps solo and empty workspace owner selectors from feeling like dead ends", () => {
    expect(ownerAssignmentHint).toContain("You are the only workspace member right now.");
    expect(ownerAssignmentHint).toContain("Invite teammates later from");
    expect(ownerAssignmentHint).toContain("href={\"/settings\" as Route}");
    expect(ownerAssignmentHint).toContain("const settingsLinkLabel = \"Open settings to invite workspace teammates\"");
    expect(ownerAssignmentHint).toContain("const settingsLinkLabel = \"Open settings to manage workspace members\"");
    expect(ownerAssignmentHint).toContain("aria-label={settingsLinkLabel}");
    expect(ownerAssignmentHint).toContain("title={settingsLinkLabel}");
    expect(ownerAssignmentHint).toContain("Save unassigned for now");

    for (const form of [dealForm, leadForm, contactForm, organizationForm, activityForm, activityEditForm]) {
      expect(form).toContain("No workspace members available");
      expect(form).toContain("OwnerAssignmentHint");
      expect(form).toContain("<OwnerAssignmentHint owners={owners} />");
      expect(form).not.toContain("function OwnerHint");
    }
  });

  it("uses assignment language on editable activity/contact/org/lead forms and a specific deal-owner label for deals", () => {
    expect(dealForm).toContain("<FormFieldLabel>Deal owner</FormFieldLabel>");
    for (const form of [leadForm, contactForm, organizationForm, activityForm, activityEditForm]) {
      expect(form).toContain("<FormFieldLabel>Assigned to</FormFieldLabel>");
    }
  });
});
