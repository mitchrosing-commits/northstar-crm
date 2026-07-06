import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const openapi = readFileSync(join(process.cwd(), "docs/openapi.yaml"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");

describe("workspace API routing", () => {
  it("keeps tenant-owned routes under workspace scope", () => {
    for (const resource of [
      "pipelines",
      "stages",
      "deals",
      "deal-line-items",
      "quotes",
      "products",
      "leads",
      "people",
      "organizations",
      "activities",
      "contract-steps",
      "notes",
      "meeting-intakes",
      "meeting-intake-upload-capabilities",
      "meeting-intake-multipart-upload-sessions",
      "meeting-intake-upload-sessions",
      "email-logs",
      "email-templates",
      "custom-fields",
      "custom-field-values",
      "exports",
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
      "closeDealSchema",
      "createDealLineItemSchema",
      "createDealContractStepSchema",
      "updateDealContractStepSchema",
      "updateQuoteAdjustmentsSchema",
      "createProductSchema",
      "updateProductSchema",
      "createLeadSchema",
      "updateLeadSchema",
      "convertLeadSchema",
      "createPersonSchema",
      "updatePersonSchema",
      "createOrganizationSchema",
      "updateOrganizationSchema",
      "createActivitySchema",
      "updateActivitySchema",
      "createNoteSchema",
      "createEmailLogSchema",
      "createEmailTemplateSchema",
      "updateEmailTemplateSchema",
      "createCustomFieldSchema",
      "upsertCustomFieldValuesSchema"
    ]) {
      expect(route).toContain(`${schemaName}.parse`);
    }
  });

  it("documents request bodies for validated product, line-item, and quote adjustment writes", () => {
    for (const schemaName of [
      "DealLineItemInput",
      "ProductInput",
      "QuoteAdjustmentsInput"
    ]) {
      expect(openapi).toContain(`${schemaName}:`);
      expect(openapi).toContain(`$ref: "#/components/schemas/${schemaName}"`);
    }

    for (const validatorName of [
      "createDealLineItemSchema",
      "updateQuoteAdjustmentsSchema",
      "createProductSchema",
      "updateProductSchema"
    ]) {
      expect(route).toContain(`${validatorName}.parse`);
    }

    expect(openapi).toContain("/workspaces/{workspaceId}/deals/{dealId}/line-items");
    expect(openapi).toContain("/workspaces/{workspaceId}/quotes/{quoteId}/adjustments");
    expect(openapi).toContain("/workspaces/{workspaceId}/products");
    expect(openapi).toContain("/workspaces/{workspaceId}/products/{productId}");
  });

  it("requires singleton workspace API routes to end after their id segment", () => {
    for (const resource of [
      "pipelines",
      "stages",
      "deals",
      "deal-line-items",
      "contract-steps",
      "products",
      "leads",
      "people",
      "organizations",
      "activities",
      "notes",
      "email-templates"
    ]) {
      expect(route).toContain(`resource === "${resource}" && idOrNested && !nestedResource`);
    }
  });

  it("requires nested workspace API routes to end after their action segment", () => {
    for (const predicate of [
      `resource === "pipelines" && idOrNested && nestedResource === "stages" && !extraSegment`,
      `resource === "deals" && idOrNested && nestedResource === "close" && !extraSegment`,
      `resource === "deals" && idOrNested && nestedResource === "reopen" && !extraSegment`,
      `resource === "deals" && idOrNested && nestedResource === "line-items" && !extraSegment`,
      `resource === "deals" && idOrNested && nestedResource === "contracts" && !extraSegment`,
      `resource === "deals" && idOrNested && nestedResource === "quotes" && !extraSegment`,
      `resource === "quotes" && idOrNested && nestedResource === "mark-sent" && !extraSegment`,
      `resource === "quotes" && idOrNested && nestedResource === "accept" && !extraSegment`,
      `resource === "quotes" && idOrNested && nestedResource === "decline" && !extraSegment`,
      `resource === "quotes" && idOrNested && nestedResource === "sync-deal-value" && !extraSegment`,
      `resource === "quotes" && idOrNested && nestedResource === "adjustments" && !extraSegment`,
      `resource === "quotes" && idOrNested && nestedResource === "public-link" && !extraSegment`,
      `resource === "products" && idOrNested && nestedResource === "deactivate" && !extraSegment`,
      `resource === "products" && idOrNested && nestedResource === "activate" && !extraSegment`,
      `resource === "leads" && idOrNested && nestedResource === "convert" && !extraSegment`,
      `resource === "meeting-intakes" && idOrNested && nestedResource === "apply" && !extraSegment`,
      `resource === "meeting-intake-multipart-upload-sessions" && idOrNested && nestedResource === "parts" && !extraSegment`,
      `resource === "meeting-intake-multipart-upload-sessions" && idOrNested && nestedResource === "complete" && !extraSegment`,
      `resource === "meeting-intake-multipart-upload-sessions" && idOrNested && nestedResource === "abort" && !extraSegment`,
      `resource === "meeting-intake-upload-sessions" && idOrNested && nestedResource === "finalize" && !extraSegment`,
      `resource === "email-templates" && idOrNested && nestedResource === "deactivate" && !extraSegment`,
      `resource === "email-templates" && idOrNested && nestedResource === "activate" && !extraSegment`
    ]) {
      expect(route).toContain(predicate);
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
    expect(routeMap).toContain("GET /login");
    expect(routeMap).toContain("logoutAction");
    expect(routeMap).toContain("trimmed workspace name of 120 characters or fewer");
    expect(routeMap).toContain("Notes attached to deleted parent records are excluded");
    expect(openapi).toContain("Trusted upstream/session user id header or local session cookie");
  });

  it("keeps REST list filtering expectations honest in the API docs", () => {
    expect(routeMap).toContain(
      "Core REST list endpoints such as `/deals`, `/leads`, `/people`, `/organizations`, and `/activities` return workspace-scoped snapshots"
    );
    expect(routeMap).toContain("Use the `/exports/*` CSV endpoints when the current filtered browser list needs to be downloaded");

    for (const [resource, exportResource] of [
      ["deals", "deals"],
      ["leads", "leads"],
      ["people", "contacts"],
      ["organizations", "organizations"],
      ["activities", "activities"]
    ] as const) {
      expect(openapi).toContain(`/workspaces/{workspaceId}/${resource}:`);
      expect(openapi).toContain(
        `Browser list filters are not accepted on this REST list endpoint; use \`/workspaces/{workspaceId}/exports/${exportResource}\` for filtered all-row CSV downloads.`
      );
    }
  });

  it("documents existing nested and utility workspace API routes", () => {
    for (const path of [
      "/api/v1/workspaces/:workspaceId/notes/:noteId",
      "/api/v1/workspaces/:workspaceId/deals/:dealId/reopen",
      "/api/v1/workspaces/:workspaceId/deals/:dealId/line-items",
      "/api/v1/workspaces/:workspaceId/deals/:dealId/contracts",
      "/api/v1/workspaces/:workspaceId/contract-steps/:contractStepId",
      "/api/v1/workspaces/:workspaceId/deal-line-items/:lineItemId",
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/mark-sent",
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/adjustments",
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/public-link",
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/sync-deal-value",
      "/api/v1/workspaces/:workspaceId/products/:productId/deactivate",
      "/api/v1/workspaces/:workspaceId/products/:productId/activate",
      "/api/v1/workspaces/:workspaceId/meeting-intakes",
      "/api/v1/workspaces/:workspaceId/meeting-intakes/:intakeId",
      "/api/v1/workspaces/:workspaceId/meeting-intakes/:intakeId/apply",
      "/api/v1/workspaces/:workspaceId/meeting-intake-upload-capabilities",
      "/api/v1/workspaces/:workspaceId/meeting-intake-multipart-upload-sessions",
      "/api/v1/workspaces/:workspaceId/meeting-intake-multipart-upload-sessions/:uploadSessionId",
      "/api/v1/workspaces/:workspaceId/meeting-intake-multipart-upload-sessions/:uploadSessionId/parts",
      "/api/v1/workspaces/:workspaceId/meeting-intake-multipart-upload-sessions/:uploadSessionId/complete",
      "/api/v1/workspaces/:workspaceId/meeting-intake-multipart-upload-sessions/:uploadSessionId/abort",
      "/api/v1/workspaces/:workspaceId/meeting-intake-upload-sessions",
      "/api/v1/workspaces/:workspaceId/meeting-intake-upload-sessions/:uploadSessionId/finalize",
      "/api/v1/workspaces/:workspaceId/email-templates/:templateId/deactivate",
      "/api/v1/workspaces/:workspaceId/email-templates/:templateId/activate",
      "/api/v1/workspaces/:workspaceId/custom-field-values",
      "/api/v1/workspaces/:workspaceId/exports/deals",
      "/api/v1/workspaces/:workspaceId/exports/activities",
      "/api/v1/workspaces/:workspaceId/exports/products",
      "/api/v1/workspaces/:workspaceId/exports/quotes",
      "/api/internal/meeting-intelligence/media-extract"
    ]) {
      expect(routeMap).toContain(path);
    }

    for (const path of [
      "/workspaces/{workspaceId}/notes/{noteId}",
      "/workspaces/{workspaceId}/deals/{dealId}/reopen",
      "/workspaces/{workspaceId}/deals/{dealId}/line-items",
      "/workspaces/{workspaceId}/deals/{dealId}/contracts",
      "/workspaces/{workspaceId}/contract-steps/{contractStepId}",
      "/workspaces/{workspaceId}/deal-line-items/{lineItemId}",
      "/workspaces/{workspaceId}/quotes/{quoteId}/mark-sent",
      "/workspaces/{workspaceId}/quotes/{quoteId}/adjustments",
      "/workspaces/{workspaceId}/quotes/{quoteId}/public-link",
      "/workspaces/{workspaceId}/quotes/{quoteId}/sync-deal-value",
      "/workspaces/{workspaceId}/products/{productId}/deactivate",
      "/workspaces/{workspaceId}/products/{productId}/activate",
      "/workspaces/{workspaceId}/meeting-intakes",
      "/workspaces/{workspaceId}/meeting-intakes/{intakeId}",
      "/workspaces/{workspaceId}/meeting-intakes/{intakeId}/apply",
      "/workspaces/{workspaceId}/meeting-intake-upload-capabilities",
      "/workspaces/{workspaceId}/meeting-intake-multipart-upload-sessions",
      "/workspaces/{workspaceId}/meeting-intake-multipart-upload-sessions/{uploadSessionId}",
      "/workspaces/{workspaceId}/meeting-intake-multipart-upload-sessions/{uploadSessionId}/parts",
      "/workspaces/{workspaceId}/meeting-intake-multipart-upload-sessions/{uploadSessionId}/complete",
      "/workspaces/{workspaceId}/meeting-intake-multipart-upload-sessions/{uploadSessionId}/abort",
      "/workspaces/{workspaceId}/meeting-intake-upload-sessions",
      "/workspaces/{workspaceId}/meeting-intake-upload-sessions/{uploadSessionId}/finalize",
      "/workspaces/{workspaceId}/email-templates/{templateId}/deactivate",
      "/workspaces/{workspaceId}/email-templates/{templateId}/activate",
      "/workspaces/{workspaceId}/custom-field-values",
      "/workspaces/{workspaceId}/exports/deals",
      "/workspaces/{workspaceId}/exports/activities",
      "/workspaces/{workspaceId}/exports/products",
      "/workspaces/{workspaceId}/exports/quotes"
    ]) {
      expect(openapi).toContain(path);
    }
  });

  it("documents lifecycle locks for follow-up context APIs", () => {
    expect(routeMap).toContain("Activity creation can attach to an open deal, unconverted lead, person, or organization.");
    expect(routeMap).toContain(
      "Deal-attached activities on closed deals and lead-attached activities on converted leads reject update, completion, and deletion."
    );
    expect(routeMap).toContain("Note creation can attach to an open deal, unconverted lead, person, or organization.");
    expect(routeMap).toContain("Closed deals and converted leads reject new note creation and note deletion.");
    expect(routeMap).toContain("Manual email logs can attach to an open deal, unconverted lead, person, or organization.");
    expect(routeMap).toContain("Closed deals and converted leads reject new manual email logs.");

    expect(openapi).toContain(
      "Activities can attach to open deals, unconverted leads, contacts, or organizations. Closed deals and converted leads reject new activities."
    );
    expect(openapi).toContain(
      "Deal-attached activities on closed deals and lead-attached activities on converted leads reject update, completion, and deletion; attachments cannot be changed."
    );
    expect(openapi).toContain(
      "Notes can attach to open deals, unconverted leads, contacts, or organizations. Closed deals and converted leads reject new notes."
    );
    expect(openapi).toContain("Notes attached to closed deals or converted leads reject deletion.");
    expect(openapi).toContain(
      "Email logs can attach to open deals, unconverted leads, contacts, or organizations. Closed deals and converted leads reject new manual email logs."
    );
  });

  it("keeps activity lifecycle documentation out of the Meeting Intelligence section", () => {
    const activitySection = routeMap.slice(routeMap.indexOf("## Activities"), routeMap.indexOf("## Meeting Intelligence"));
    const meetingIntelligenceSection = routeMap.slice(routeMap.indexOf("## Meeting Intelligence"), routeMap.indexOf("## Notes"));

    expect(activitySection).toContain("Completed activities are locked from normal edits and deletion.");
    expect(activitySection).toContain("The browser Activities page supports overdue, today, upcoming, no-due-date");
    expect(meetingIntelligenceSection).toContain(
      "Supported sources are pasted text, markdown, text files, RTF, HTML/HTM, CSV, JSON, text-based PDFs, and DOCX files."
    );
    expect(meetingIntelligenceSection).toContain("empty source submissions return `422 VALIDATION_ERROR` before any intake record is created");
    expect(openapi).toContain("empty source submissions return 422 before a record is created");
    expect(openapi).toContain("Empty source submissions return 422 before an intake record is created.");
    expect(meetingIntelligenceSection).not.toContain("The browser Activities page supports overdue");
  });
});
