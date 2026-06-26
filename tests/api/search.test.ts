import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(join(process.cwd(), "lib/services/search-service.ts"), "utf8");
const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
const searchPage = readFileSync(join(process.cwd(), "app/search/page.tsx"), "utf8");

describe("global workspace search", () => {
  it("adds a search entry point in the app shell", () => {
    expect(appShell).toContain("href: \"/search\"");
    expect(appShell).toContain("label: \"Search\"");
    expect(appShell).toContain("Search");
  });

  it("searches workspace-scoped CRM records with limited contains queries", () => {
    expect(service).toContain("export async function searchCrm");
    expect(service).toContain("await ensureWorkspaceAccess(actor)");
    expect(service).toContain("mode: \"insensitive\"");
    expect(service).toContain("workspaceId: actor.workspaceId");
    expect(service).toContain("take: searchTake");
    expect(service).toContain("prisma.deal.findMany");
    expect(service).toContain("prisma.lead.findMany");
    expect(service).toContain("prisma.person.findMany");
    expect(service).toContain("prisma.organization.findMany");
    expect(service).toContain("prisma.activity.findMany");
    expect(service).toContain("prisma.note.findMany");
  });

  it("adds a query-driven grouped search page with useful empty states", () => {
    expect(searchPage).toContain("searchParams: Promise<{ q?: string }>");
    expect(searchPage).toContain("searchCrm({ workspaceId: workspace.id, actorUserId }, q)");
    expect(searchPage).toContain("SearchSection title=\"Deals\"");
    expect(searchPage).toContain("SearchSection title=\"Leads\"");
    expect(searchPage).toContain("SearchSection title=\"Contacts\"");
    expect(searchPage).toContain("SearchSection title=\"Organizations\"");
    expect(searchPage).toContain("SearchSection title=\"Activities\"");
    expect(searchPage).toContain("SearchSection title=\"Notes\"");
    expect(searchPage).toContain("Search workspace records");
    expect(searchPage).toContain("Search your workspace");
    expect(searchPage).toContain("internal note text");
    expect(searchPage).toContain("No results found");
    expect(searchPage).toContain("Try a record name, email, domain, activity title, or note text.");
  });

  it("renders readable activity and note result context without raw internal labels", () => {
    expect(searchPage).toContain("formatActivityType(activity.type)");
    expect(searchPage).toContain("Activity: ${formatActivityType(activity.type)}");
    expect(searchPage).toContain("activityDueLabel(activity.dueAt)");
    expect(searchPage).toContain("No due date");
    expect(searchPage).toContain("notePreview(note.body)");
    expect(searchPage).toContain("Note: ${preview(body)}");
    expect(searchPage).toContain("Internal note added");
    expect(searchPage).toContain("Author:");
    expect(searchPage).not.toContain("meta={[activity.type");
  });

  it("links results to the best available detail page", () => {
    expect(searchPage).toContain("href={`/deals/${deal.id}` as Route}");
    expect(searchPage).toContain("href={`/leads/${lead.id}` as Route}");
    expect(searchPage).toContain("href={`/contacts/${person.id}` as Route}");
    expect(searchPage).toContain("href={`/organizations/${organization.id}` as Route}");
    expect(searchPage).toContain("function attachmentTarget");
    expect(searchPage).toContain("return \"/activities\"");
  });
});
