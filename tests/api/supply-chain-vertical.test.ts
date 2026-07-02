import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  supplyChainActivityNameExamples,
  supplyChainDashboardQuestions,
  supplyChainDealFieldTemplates,
  supplyChainDeferredBoundaries,
  supplyChainLeadFieldTemplates,
  supplyChainOrganizationFieldTemplates,
  supplyChainSavedViewRecommendations,
  supplyChainServiceCatalogExamples
} from "@/lib/supply-chain-implementation-config";

const guide = readFileSync(join(process.cwd(), "docs/supply-chain-implementation-crm-guide.md"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const settingsPanel = readFileSync(join(process.cwd(), "app/settings/supply-chain-vertical-panel.tsx"), "utf8");
const settingsGuideCard = readFileSync(join(process.cwd(), "app/settings/settings-guide-card.tsx"), "utf8");
const settingsActions = readFileSync(join(process.cwd(), "app/settings/actions.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const setupService = readFileSync(join(process.cwd(), "lib/services/supply-chain-vertical-service.ts"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const compactList = readFileSync(join(process.cwd(), "components/compact-list.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("supply-chain implementation consulting vertical guidance", () => {
  it("documents practical CRM usage without turning Northstar into warehouse software", () => {
    expect(guide).toContain("# Supply-chain implementation CRM guide");
    expect(guide).toContain("Recommended Pipeline Structure");
    expect(guide).toContain("Recommended Custom Fields");
    expect(guide).toContain("Recommended Saved Views");
    expect(guide).toContain("Optional Setup Workflow");
    expect(guide).toContain("Product / Service Catalog Examples");
    expect(guide).toContain("Quote Patterns");
    expect(guide).toContain("Contract Workflow Usage");
    expect(guide).toContain("Import / Export Usage");
    expect(guide).toContain("What Northstar Should Not Do Yet");
    expect(guide).toContain("NDA -> MSA -> SOW");
    expect(guide).toContain("SOW: implementation phases, scope, assumptions, exclusions, milestones");
    expect(guide).toContain("Activity saved views should remain deferred");
    expect(guide).toContain("Do not import custom field values until explicit mapping and validation are available");
    expect(guide).toContain("The setup action is intentionally idempotent");
    expect(guide).toContain("can create these examples as editable zero-price service templates");
  });

  it("defines safe optional custom-field templates for deals, accounts, and leads", () => {
    expect(supplyChainDealFieldTemplates.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "Opportunity Type",
        "System Category",
        "Project Phase",
        "Go-Live Target Date",
        "Integration Complexity",
        "Risk Level",
        "Operational Pain Area",
        "Support Needed After Go-Live"
      ])
    );
    expect(supplyChainOrganizationFieldTemplates.map((field) => field.name)).toEqual(
      expect.arrayContaining(["Industry", "Warehouse / DC Count", "Current WMS", "Distribution Complexity", "Expansion Potential"])
    );
    expect(supplyChainLeadFieldTemplates.map((field) => field.name)).toEqual(
      expect.arrayContaining(["Inquiry Type", "Primary Operational Pain", "Urgency", "Decision Maker Known"])
    );
    expect(supplyChainDealFieldTemplates.every((field) => ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"].includes(field.fieldType))).toBe(true);
    expect(supplyChainDealFieldTemplates.length).toBeGreaterThan(20);
    expect(supplyChainOrganizationFieldTemplates.length).toBeGreaterThan(10);
    expect(supplyChainLeadFieldTemplates.length).toBeGreaterThan(10);
  });

  it("recommends saved views, activity names, dashboard questions, and service catalog examples", () => {
    expect(supplyChainSavedViewRecommendations.map((view) => view.name)).toEqual(
      expect.arrayContaining(["Implementation Opportunities", "High-Risk Opportunities", "Go-Live This Quarter", "Active SOW / Contracting Deals"])
    );
    expect(supplyChainActivityNameExamples).toEqual(
      expect.arrayContaining(["Discovery Call", "Warehouse Process Walkthrough", "Go-Live Readiness Review", "SOW Review"])
    );
    expect(supplyChainDashboardQuestions).toEqual(
      expect.arrayContaining([
        "Which implementation or support deals need attention?",
        "Which SOWs or contract steps need action?"
      ])
    );
    expect(supplyChainServiceCatalogExamples).toEqual(
      expect.arrayContaining(["Software Selection Workshop", "Solution Design Package", "Managed Support Retainer", "Implementation Accelerator Package"])
    );
  });

  it("surfaces the vertical setup in Settings without seeding or mutating workspace data", () => {
    expect(settingsPage).toContain("<SupplyChainVerticalPanel");
    expect(settingsPage).toContain("getSupplyChainVerticalSetupStatus(actor)");
    expect(settingsPanel).toContain("Supply-chain implementation setup");
    expect(settingsPanel).toContain("SettingsGuideCard");
    expect(settingsGuideCard).toContain("CompactTitleRow");
    expect(settingsGuideCard).toContain("const guideActionLabel = `${title}: ${actionLabel}`");
    expect(settingsGuideCard).toContain("aria-label={guideActionLabel}");
    expect(settingsGuideCard).toContain("title={guideActionLabel}");
    expect(settingsPanel).toContain("FormIntroCallout");
    expect(settingsPanel).toContain("Apply safe presets");
    expect(settingsPanel).toContain("SetupStatusCard");
    expect(settingsPanel).toContain("applySupplyChainVerticalSetupAction");
    expect(settingsPanel).toContain("Configure custom fields");
    expect(settingsPanel).toContain("Build saved views from filtered lists");
    expect(settingsPanel).toContain("Configure service catalog");
    expect(settingsPanel).toContain("className=\"section-spaced supply-chain-dashboard-callout\"");
    expect(settingsPanel).toContain("title=\"Dashboard questions\"");
    expect(settingsPanel).toContain("Kept out of this CRM setup");
    expect(settingsPanel).toContain("className=\"supply-chain-boundary-callout\"");
    expect(settingsPanel).toContain("details={");
    expect(settingsPanel).toContain("import { CompactList }");
    expect(settingsPanel).toContain('<CompactList as="ul">');
    expect(settingsPanel).not.toContain('<ul className="compact-list">');
    expect(compactList).toContain('as?: "div" | "ul"');
    expect(settingsPanel).not.toContain("<div className=\"form-callout supply-chain-boundary-callout\">");
    expect(settingsPanel).not.toContain("<p className=\"empty-copy\">{supplyChainDashboardQuestions.slice(0, 3).join(\" \")}</p>");
    expect(settingsPanel).not.toContain("<p className=\"empty-copy\">{supplyChainDeferredBoundaries.join(\" \")}</p>");
    expect(settingsActions).toContain("applySupplyChainVerticalPresets(actor)");
    expect(settingsActions).toContain("supplyChainSetup=applied");
    expect(styles).toContain(".settings-setup-status-grid");
    expect(styles).toContain(".setup-status-card");
    expect(styles).toContain(".settings-guide-grid");
    expect(styles).toContain(".checklist");
    expect(styles).not.toContain(".panel-subtitle");
  });

  it("adds an idempotent service foundation for applying real presets", () => {
    expect(crmBarrel).toContain("supply-chain-vertical-service");
    expect(setupService).toContain("getSupplyChainVerticalSetupStatus");
    expect(setupService).toContain("applySupplyChainVerticalPresets");
    expect(setupService).toContain("applySupplyChainCustomFieldPresets");
    expect(setupService).toContain("applySupplyChainSavedViewPresets");
    expect(setupService).toContain("applySupplyChainProductCatalogPresets");
    expect(setupService).toContain("existingActive.has(identity)");
    expect(setupService).toContain("existingViews.has(identity)");
    expect(setupService).toContain("existingNames.has(normalizedName)");
    expect(setupService).toContain("unitPriceCents: 0");
    expect(setupService).toContain("SavedViewRecordType does not include ACTIVITY");
    expect(setupService).toContain("SELECT values");
  });

  it("records the deliberate vertical boundaries", () => {
    expect(supplyChainDeferredBoundaries.join(" ")).toContain("No WMS, OMS, ERP, TMS, LMS, WES");
    expect(supplyChainDeferredBoundaries.join(" ")).toContain("No full project-management");
    expect(supplyChainDeferredBoundaries.join(" ")).toContain("No facility/site schema");
    expect(currentStatus).toContain("docs/supply-chain-implementation-crm-guide.md");
    expect(currentStatus).toContain("idempotently create recommended custom fields");
    expect(currentStatus).toContain("advisory, software selection, implementation, optimization, support");
  });
});
