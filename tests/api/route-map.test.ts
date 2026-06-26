import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const openapi = readFileSync(join(process.cwd(), "docs/openapi.yaml"), "utf8");

describe("workspace API routing", () => {
  it("keeps tenant-owned routes under workspace scope", () => {
    for (const resource of [
      "pipelines",
      "stages",
      "deals",
      "products",
      "leads",
      "people",
      "organizations",
      "activities",
      "notes",
      "email-logs",
      "email-templates",
      "custom-fields",
      "audit-logs"
    ]) {
      expect(route).toContain(`resource === "${resource}"`);
      expect(openapi).toContain(`/workspaces/{workspaceId}/${resource}`);
    }
  });

  it("validates create and update payloads before calling services", () => {
    for (const schemaName of [
      "createDealSchema",
      "updateDealSchema",
      "createPersonSchema",
      "updatePersonSchema",
      "createOrganizationSchema",
      "updateOrganizationSchema",
      "createActivitySchema",
      "updateActivitySchema",
      "createEmailLogSchema",
      "createEmailTemplateSchema",
      "updateEmailTemplateSchema"
    ]) {
      expect(route).toContain(`${schemaName}.parse`);
    }
  });

  it("keeps the CRM service compatibility barrel in place", () => {
    for (const moduleName of [
      "activity-service",
      "audit-service",
      "contact-service",
      "custom-field-service",
      "dashboard-service",
      "deal-service",
      "email-service",
      "lead-service",
      "note-service",
      "organization-service",
      "pipeline-service",
      "search-service",
      "timeline-service",
      "workspace-service"
    ]) {
      expect(crmBarrel).toContain(`export * from "./${moduleName}"`);
    }
  });

  it("documents local login as browser-only auth groundwork", () => {
    const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");

    expect(routeMap).toContain("GET /login");
    expect(routeMap).toContain("logoutAction");
    expect(openapi).toContain("Trusted upstream/session user id header or local session cookie");
  });

  it("documents existing nested and utility workspace API routes", () => {
    const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");

    for (const path of [
      "/api/v1/workspaces/:workspaceId/notes/:noteId",
      "/api/v1/workspaces/:workspaceId/deals/:dealId/line-items",
      "/api/v1/workspaces/:workspaceId/deal-line-items/:lineItemId",
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/sync-deal-value",
      "/api/v1/workspaces/:workspaceId/exports/deals",
      "/api/v1/workspaces/:workspaceId/exports/activities",
      "/api/v1/workspaces/:workspaceId/exports/quotes"
    ]) {
      expect(routeMap).toContain(path);
    }

    for (const path of [
      "/workspaces/{workspaceId}/notes/{noteId}",
      "/workspaces/{workspaceId}/deals/{dealId}/line-items",
      "/workspaces/{workspaceId}/deal-line-items/{lineItemId}",
      "/workspaces/{workspaceId}/quotes/{quoteId}/sync-deal-value",
      "/workspaces/{workspaceId}/exports/deals",
      "/workspaces/{workspaceId}/exports/activities",
      "/workspaces/{workspaceId}/exports/quotes"
    ]) {
      expect(openapi).toContain(path);
    }
  });
});
