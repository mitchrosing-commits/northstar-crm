import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const dealForm = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");
const leadForm = readFileSync(join(process.cwd(), "components/lead-form.tsx"), "utf8");
const contactForm = readFileSync(join(process.cwd(), "components/contact-form.tsx"), "utf8");
const organizationForm = readFileSync(join(process.cwd(), "components/organization-form.tsx"), "utf8");
const activityForm = readFileSync(join(process.cwd(), "components/activity-form.tsx"), "utf8");
const activityEditForm = readFileSync(join(process.cwd(), "components/activity-edit-form.tsx"), "utf8");
const newDealPage = readFileSync(join(process.cwd(), "app/deals/new/page.tsx"), "utf8");
const newLeadPage = readFileSync(join(process.cwd(), "app/leads/new/page.tsx"), "utf8");
const newContactPage = readFileSync(join(process.cwd(), "app/contacts/new/page.tsx"), "utf8");
const newOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/new/page.tsx"), "utf8");
const newActivityPage = readFileSync(join(process.cwd(), "app/activities/new/page.tsx"), "utf8");

describe("owner assignment UX", () => {
  it("defaults create forms to the current workspace user when available", () => {
    expect(newDealPage).toContain("defaultOwnerId={actorUserId}");
    expect(newLeadPage).toContain("defaultOwnerId={actorUserId}");
    expect(newContactPage).toContain("defaultOwnerId={actorUserId}");
    expect(newOrganizationPage).toContain("defaultOwnerId={actorUserId}");
    expect(newActivityPage).toContain("defaultOwnerId={actorUserId}");

    for (const form of [dealForm, leadForm, contactForm, organizationForm]) {
      expect(form).toContain("defaultOwnerId?: string");
      expect(form).toContain("mode === \"create\" ? defaultOwnerId");
      expect(form).toContain("owners.length === 1 ? owners[0]?.id");
    }
  });

  it("keeps solo and empty workspace owner selectors from feeling like dead ends", () => {
    for (const form of [dealForm, leadForm, contactForm, organizationForm, activityForm, activityEditForm]) {
      expect(form).toContain("No workspace members available");
      expect(form).toContain("You are the only workspace member right now.");
      expect(form).toContain("Invite teammates later from");
      expect(form).toContain("href={\"/settings\" as Route}");
      expect(form).toContain("Save unassigned for now");
    }
  });

  it("uses assignment language on editable activity/contact/org/lead forms and a specific deal-owner label for deals", () => {
    expect(dealForm).toContain("<span>Deal owner</span>");
    for (const form of [leadForm, contactForm, organizationForm, activityForm, activityEditForm]) {
      expect(form).toContain("<span>Assigned to</span>");
    }
  });
});
