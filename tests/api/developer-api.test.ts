import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const developerPage = readFileSync(join(process.cwd(), "app/settings/developer-api/page.tsx"), "utf8");
const pageHeader = readFileSync(join(process.cwd(), "components/page-header.tsx"), "utf8");
const compactTitleRow = readFileSync(join(process.cwd(), "components/compact-title-row.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const openapi = readFileSync(join(process.cwd(), "docs/openapi.yaml"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const smokeSpec = readFileSync(join(process.cwd(), "tests/browser/smoke.spec.ts"), "utf8");

describe("Developer/API settings surface", () => {
  it("exposes a visible settings entry point and workspace-scoped API overview", () => {
    expect(settingsPage).toContain("Developer / API");
    expect(settingsPage).toContain("href={\"/settings/developer-api\" as Route}");
    expect(developerPage).toContain("Review workspace-scoped REST coverage, export endpoints, and integration guardrails.");
    expect(developerPage).toContain("PageHeader");
    expect(developerPage).toContain('import { Badge } from "@/components/badge"');
    expect(developerPage).toContain("const backToSettingsLabel = \"Back to settings from developer API\"");
    expect(developerPage).toContain("aria-label={backToSettingsLabel}");
    expect(developerPage).toContain("title={backToSettingsLabel}");
    expect(pageHeader).toContain("className=\"header-actions\"");
    expect(developerPage).toContain("className=\"panel section-separated\"");
    expect(developerPage).toContain("PanelTitleRow");
    expect(developerPage).toContain("CompactTitleRow");
    expect(developerPage).toContain("description={resource.description}");
    expect(developerPage).toContain("title={resource.title}");
    expect(developerPage).toContain("title={surface.title}");
    expect(developerPage).not.toContain("api-resource-header");
    expect(developerPage).not.toContain("<h3>{resource.title}</h3>");
    expect(developerPage).not.toContain("<h3>{surface.title}</h3>");
    expect(compactTitleRow).toContain("export function CompactTitleRow");
    expect(globalStyles).toContain(".api-resource-card .panel-title-row");
    expect(globalStyles).toContain(".api-reference-grid > *");
    expect(globalStyles).toContain(".api-resource-card .compact-title");
    expect(globalStyles).toContain(".endpoint-list li");
    expect(globalStyles).toContain(".provider-card .panel-title-row");
    expect(developerPage).toContain("title=\"Resource Areas\"");
    expect(developerPage).toContain("const importExportActionLabel = \"Open import and export settings from developer API\"");
    expect(developerPage).toContain("aria-label={importExportActionLabel}");
    expect(developerPage).toContain("title={importExportActionLabel}");
    expect(developerPage).toContain("title=\"Platform Controls\"");
    expect(developerPage).toContain("actions={<Badge>Workspace scoped</Badge>}");
    expect(developerPage).toContain("actions={<Badge>{resource.status}</Badge>}");
    expect(developerPage).toContain("actions={<Badge>Repo docs</Badge>}");
    expect(developerPage).toContain("actions={<Badge>Preview</Badge>}");
    expect(developerPage).toContain("actions={<Badge>{surface.status}</Badge>}");
    expect(developerPage).not.toContain('className="badge"');
    expect(developerPage).toContain("description=\"Northstar exposes a growing REST surface for core CRM records.");
    expect(developerPage).toContain("description=\"The API reference is hand-maintained for this preview.");
    expect(developerPage).not.toContain("panel-intro-copy");
    expect(developerPage).toContain("empty-copy section-separated");
    expect(developerPage).not.toContain("style={{ marginBottom: 16 }}");
    expect(developerPage).toContain("API v1");
    expect(developerPage).not.toContain("API v0");
    expect(developerPage).toContain("Workspace API base");
    expect(developerPage).toContain("/api/v1/workspaces/{workspace.id}");
    expect(developerPage).toContain("401 for missing session");
    expect(developerPage).toContain("403 for non-members");
    expect(developerPage).toContain("safe 404s for cross-workspace records");
  });

  it("surfaces current CRM API resource areas without pretending imports or jobs are public APIs", () => {
    for (const resource of [
      "Pipeline Settings",
      "Deals",
      "Contacts / People",
      "Organizations",
      "Leads",
      "Activities",
      "Notes / Timeline Inputs",
      "Custom Fields",
      "Email Templates",
      "Quotes",
      "Contract Workflow",
      "Products / Line Items",
      "Import / Export",
      "Background Jobs"
    ]) {
      expect(developerPage).toContain(resource);
    }

    expect(developerPage).toContain("CSV exports are REST endpoints");
    expect(developerPage).toContain("CSV imports are browser/server-action preview flows today");
    expect(developerPage).toContain("No public job API is exposed");
    for (const endpoint of [
      "GET /pipelines",
      "POST /pipelines",
      "PATCH /pipelines/:pipelineId",
      "DELETE /pipelines/:pipelineId",
      "GET /pipelines/:pipelineId/stages",
      "POST /pipelines/:pipelineId/stages",
      "PATCH /stages/:stageId",
      "DELETE /stages/:stageId"
    ]) {
      expect(developerPage).toContain(endpoint);
    }
    for (const endpoint of [
      "GET /exports/deals",
      "GET /exports/contacts",
      "GET /exports/organizations",
      "GET /exports/leads",
      "GET /exports/activities",
      "GET /exports/products",
      "GET /exports/quotes"
    ]) {
      expect(developerPage).toContain(endpoint);
    }
    expect(developerPage).toContain("DELETE /organizations/:organizationId");
    expect(developerPage).toContain("GET /people/:personId");
    expect(developerPage).toContain("GET /organizations/:organizationId");
    expect(developerPage).toContain("DELETE /activities/:activityId");
    expect(developerPage).toContain("DELETE /notes/:noteId");
    expect(developerPage).toContain("GET /deals/:dealId");
    expect(developerPage).toContain("DELETE /deals/:dealId");
    expect(developerPage).toContain("POST /deals/:dealId/reopen");
    expect(developerPage).toContain("GET /leads/:leadId");
    expect(developerPage).toContain("Meeting Intelligence");
    expect(developerPage).toContain("GET /meeting-intakes");
    expect(developerPage).toContain("POST /meeting-intakes/:intakeId/apply");
    expect(developerPage).toContain("POST /email-logs");
    expect(developerPage).toContain("PATCH /custom-field-values");
    expect(developerPage).toContain("POST /email-templates/:templateId/deactivate");
    expect(developerPage).toContain("POST /email-templates/:templateId/activate");
    expect(developerPage).toContain("not provider sending");
    expect(developerPage).toContain("POST /products/:productId/deactivate");
    expect(developerPage).toContain("POST /products/:productId/activate");
    expect(developerPage).toContain("DELETE /deal-line-items/:lineItemId");
    expect(developerPage).toContain("POST /quotes/:quoteId/accept");
    expect(developerPage).toContain("POST /quotes/:quoteId/decline");
    expect(developerPage).toContain("PATCH /quotes/:quoteId/adjustments");
    expect(developerPage).toContain("DELETE /quotes/:quoteId/public-link");
    expect(developerPage).toContain("POST /quotes/:quoteId/sync-deal-value");
    expect(developerPage).toContain("GET /deals/:dealId/contracts");
    expect(developerPage).toContain("POST /deals/:dealId/contracts");
    expect(developerPage).toContain("PATCH /contract-steps/:contractStepId");
    expect(developerPage).toContain("npm run jobs:work");
    expect(developerPage).toContain("npm run jobs:cleanup");
  });

  it("keeps API keys and webhooks honest and disabled", () => {
    expect(developerPage).toContain("API Keys");
    expect(developerPage).toContain("API-key issuance, rotation, scopes, and last-used tracking are not implemented yet");
    expect(developerPage).toContain("Webhooks");
    expect(developerPage).toContain("Customer-configurable webhooks");
    expect(developerPage).toContain("OAuth Apps");
    expect(developerPage).toContain(
      "const plannedSurfaceActionLabel = `${surface.title} controls are planned and not yet available`",
    );
    expect(developerPage).toContain("aria-label={plannedSurfaceActionLabel}");
    expect(developerPage).toContain("title={plannedSurfaceActionLabel}");
    expect(developerPage).toContain("disabled");
    expect(developerPage).toContain('type="button"');
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
    expect(currentStatus).toContain("Custom Fields, Email Templates, Quotes, Contract Workflow");
    expect(currentStatus).toContain("API keys, webhook subscriptions, OAuth app installs, and external developer portals are not implemented");
    expect(smokeSpec).toContain("\"/settings/developer-api\"");
  });
});
