import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const developerPage = readFileSync(join(process.cwd(), "app/settings/developer-api/page.tsx"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const openapi = readFileSync(join(process.cwd(), "docs/openapi.yaml"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const smokeSpec = readFileSync(join(process.cwd(), "tests/browser/smoke.spec.ts"), "utf8");

describe("Developer/API settings surface", () => {
  it("exposes a visible settings entry point and workspace-scoped API overview", () => {
    expect(settingsPage).toContain("Developer / API");
    expect(settingsPage).toContain("href={\"/settings/developer-api\" as Route}");
    expect(developerPage).toContain("Workspace API base");
    expect(developerPage).toContain("/api/v1/workspaces/{workspace.id}");
    expect(developerPage).toContain("401 for missing session");
    expect(developerPage).toContain("403 for non-members");
    expect(developerPage).toContain("safe 404s for cross-workspace records");
  });

  it("surfaces current CRM API resource areas without pretending imports or jobs are public APIs", () => {
    for (const resource of [
      "Deals",
      "Contacts / People",
      "Organizations",
      "Leads",
      "Activities",
      "Notes / Timeline Inputs",
      "Quotes",
      "Products / Line Items",
      "Import / Export",
      "Background Jobs"
    ]) {
      expect(developerPage).toContain(resource);
    }

    expect(developerPage).toContain("CSV exports are REST endpoints");
    expect(developerPage).toContain("CSV imports are browser/server-action preview flows today");
    expect(developerPage).toContain("No public job API is exposed");
    expect(developerPage).toContain("GET /exports/deals");
    expect(developerPage).toContain("npm run jobs:work");
  });

  it("keeps API keys and webhooks honest and disabled", () => {
    expect(developerPage).toContain("API Keys");
    expect(developerPage).toContain("API-key issuance, rotation, scopes, and last-used tracking are not implemented yet");
    expect(developerPage).toContain("Webhooks");
    expect(developerPage).toContain("Customer-configurable webhooks");
    expect(developerPage).toContain("OAuth Apps");
    expect(developerPage).toContain("disabled type=\"button\"");
    expect(developerPage).not.toContain("Generate key");
    expect(developerPage).not.toContain("Create webhook");
  });

  it("references the maintained docs and updates browser smoke coverage", () => {
    expect(developerPage).toContain("docs/openapi.yaml");
    expect(developerPage).toContain("docs/api-route-map.md");
    expect(routeMap).toContain("GET /settings/developer-api");
    expect(routeMap).toContain("API keys, webhook subscriptions, and OAuth app controls are intentionally disabled/planned");
    expect(openapi).toContain("Local signup/login are browser-action flows");
    expect(currentStatus).toContain("Developer/API overview");
    expect(currentStatus).toContain("API keys, webhook subscriptions, OAuth app installs, and external developer portals are not implemented");
    expect(smokeSpec).toContain("\"/settings/developer-api\"");
  });
});
