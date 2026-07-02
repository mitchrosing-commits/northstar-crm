import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pipelineLoading = readFileSync(join(process.cwd(), "app/pipeline/loading.tsx"), "utf8");
const dealLoading = readFileSync(join(process.cwd(), "app/deals/[dealId]/loading.tsx"), "utf8");
const dealNotFound = readFileSync(join(process.cwd(), "app/deals/[dealId]/not-found.tsx"), "utf8");
const contactLoading = readFileSync(join(process.cwd(), "app/contacts/[personId]/loading.tsx"), "utf8");
const contactNotFound = readFileSync(join(process.cwd(), "app/contacts/[personId]/not-found.tsx"), "utf8");
const organizationLoading = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/loading.tsx"), "utf8");
const organizationNotFound = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/not-found.tsx"), "utf8");
const leadLoading = readFileSync(join(process.cwd(), "app/leads/[leadId]/loading.tsx"), "utf8");
const leadNotFound = readFileSync(join(process.cwd(), "app/leads/[leadId]/not-found.tsx"), "utf8");
const routeStatusState = readFileSync(join(process.cwd(), "components/route-status-state.tsx"), "utf8");

describe("route status UX", () => {
  it("uses the shared empty state primitive for loading and not-found surfaces", () => {
    expect(routeStatusState).toContain("EmptyState");
    expect(routeStatusState).toContain("titleLevel=\"h1\"");
    expect(routeStatusState).toContain("<main className=\"main\">");

    for (const source of [
      pipelineLoading,
      dealLoading,
      dealNotFound,
      contactLoading,
      contactNotFound,
      organizationLoading,
      organizationNotFound,
      leadLoading,
      leadNotFound
    ]) {
      expect(source).toContain("RouteStatusState");
      expect(source).not.toContain("<div className=\"empty-state\">");
    }

    expect(pipelineLoading).toContain("title=\"Loading pipeline\"");
    expect(pipelineLoading).toContain("description=\"Preparing stages and deals.\"");
    expect(dealLoading).toContain("title=\"Loading deal\"");
    expect(dealLoading).toContain("description=\"Fetching deal details, activities, and notes.\"");
    expect(dealNotFound).toContain("title=\"Deal not found\"");
    expect(dealNotFound).toContain("This deal may have been deleted or may not belong to the current workspace.");
    expect(dealNotFound).toContain('const backToPipelineLabel = "Back to pipeline from missing deal"');
    expect(dealNotFound).toContain("aria-label={backToPipelineLabel}");
    expect(dealNotFound).toContain("title={backToPipelineLabel}");
    expect(dealNotFound).toContain("href=\"/pipeline\"");
    expect(dealNotFound).toContain("className=\"button-secondary\"");
    expect(dealNotFound).not.toContain("className=\"text-link\"");
    expect(contactLoading).toContain("title=\"Loading contact\"");
    expect(contactLoading).toContain("Fetching contact details, activities, and relationship history.");
    expect(contactNotFound).toContain("title=\"Contact not found\"");
    expect(contactNotFound).toContain('const backToContactsLabel = "Back to contacts from missing contact"');
    expect(contactNotFound).toContain("aria-label={backToContactsLabel}");
    expect(contactNotFound).toContain("title={backToContactsLabel}");
    expect(contactNotFound).toContain("href=\"/contacts\"");
    expect(organizationLoading).toContain("title=\"Loading organization\"");
    expect(organizationLoading).toContain("Fetching organization details, people, deals, and activity history.");
    expect(organizationNotFound).toContain("title=\"Organization not found\"");
    expect(organizationNotFound).toContain('const backToOrganizationsLabel = "Back to organizations from missing organization"');
    expect(organizationNotFound).toContain("aria-label={backToOrganizationsLabel}");
    expect(organizationNotFound).toContain("title={backToOrganizationsLabel}");
    expect(organizationNotFound).toContain("href=\"/organizations\"");
    expect(leadLoading).toContain("title=\"Loading lead\"");
    expect(leadLoading).toContain("Fetching lead details, conversion context, activities, and notes.");
    expect(leadNotFound).toContain("title=\"Lead not found\"");
    expect(leadNotFound).toContain('const backToLeadsLabel = "Back to leads from missing lead"');
    expect(leadNotFound).toContain("aria-label={backToLeadsLabel}");
    expect(leadNotFound).toContain("title={backToLeadsLabel}");
    expect(leadNotFound).toContain("href=\"/leads\"");
  });
});
