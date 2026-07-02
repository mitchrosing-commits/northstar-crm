export type VerticalEntityType = "DEAL" | "LEAD" | "ORGANIZATION";
export type VerticalFieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";

export type VerticalCustomFieldTemplate = {
  entityType: VerticalEntityType;
  name: string;
  key: string;
  fieldType: VerticalFieldType;
  options?: string[];
  use: string;
};

export type VerticalSavedViewRecommendation = {
  recordType: VerticalEntityType;
  name: string;
  filterHint: string;
};

export const supplyChainDealFieldTemplates: VerticalCustomFieldTemplate[] = [
  {
    entityType: "DEAL",
    name: "Opportunity Type",
    key: "opportunity_type",
    fieldType: "SELECT",
    options: ["Advisory", "Software Selection", "Implementation", "Optimization", "Support", "Upgrade", "Accelerator / Tooling"],
    use: "Qualify whether the opportunity is advisory, selection, delivery, support, or tooling work."
  },
  {
    entityType: "DEAL",
    name: "Service Line",
    key: "service_line",
    fieldType: "SELECT",
    options: ["Planning", "Selection", "Design", "Configuration", "Integration", "Testing", "Go-Live", "Stabilization", "Support", "Optimization"],
    use: "Describe the primary consulting workstream."
  },
  {
    entityType: "DEAL",
    name: "System Category",
    key: "system_category",
    fieldType: "SELECT",
    options: ["WMS", "OMS", "ERP", "TMS", "LMS", "WES", "Reporting", "Integration", "Automation", "Other"],
    use: "Show which supply-chain system family drives the scope."
  },
  {
    entityType: "DEAL",
    name: "Current Platform",
    key: "current_platform",
    fieldType: "TEXT",
    use: "Capture the incumbent system or current operating platform."
  },
  {
    entityType: "DEAL",
    name: "Target Platform",
    key: "target_platform",
    fieldType: "TEXT",
    use: "Capture the selected or candidate future platform."
  },
  {
    entityType: "DEAL",
    name: "Deployment Model",
    key: "deployment_model",
    fieldType: "SELECT",
    options: ["Cloud", "On-Premise", "Hybrid", "Undecided"],
    use: "Track deployment assumptions that influence scope and risk."
  },
  {
    entityType: "DEAL",
    name: "Facility Count",
    key: "facility_count",
    fieldType: "NUMBER",
    use: "Estimate affected facilities during opportunity qualification."
  },
  {
    entityType: "DEAL",
    name: "Warehouse / DC Count",
    key: "warehouse_dc_count",
    fieldType: "NUMBER",
    use: "Capture warehouse or distribution center count on the opportunity."
  },
  {
    entityType: "DEAL",
    name: "Distribution Network Scope",
    key: "distribution_network_scope",
    fieldType: "TEXT",
    use: "Summarize regions, business units, or facility groups impacted."
  },
  {
    entityType: "DEAL",
    name: "Regions Impacted",
    key: "regions_impacted",
    fieldType: "TEXT",
    use: "Keep rollout geography visible."
  },
  {
    entityType: "DEAL",
    name: "Omnichannel Fulfillment",
    key: "omnichannel_fulfillment",
    fieldType: "BOOLEAN",
    use: "Flag opportunities tied to omnichannel operating complexity."
  },
  {
    entityType: "DEAL",
    name: "Project Phase",
    key: "project_phase",
    fieldType: "SELECT",
    options: ["Discovery", "Selection", "Design", "Build", "Test", "UAT", "Go-Live", "Stabilization", "Support"],
    use: "Track readiness without turning the CRM into a project plan."
  },
  {
    entityType: "DEAL",
    name: "Go-Live Target Date",
    key: "go_live_target_date",
    fieldType: "DATE",
    use: "Surface implementation timing risk and contracting urgency."
  },
  {
    entityType: "DEAL",
    name: "Decision Timeline",
    key: "decision_timeline",
    fieldType: "TEXT",
    use: "Record buying, steering committee, or procurement timing."
  },
  {
    entityType: "DEAL",
    name: "Implementation Urgency",
    key: "implementation_urgency",
    fieldType: "SELECT",
    options: ["Low", "Medium", "High"],
    use: "Separate urgent go-live/support needs from exploratory work."
  },
  {
    entityType: "DEAL",
    name: "Integration Complexity",
    key: "integration_complexity",
    fieldType: "SELECT",
    options: ["Low", "Medium", "High"],
    use: "Flag complex system landscapes early in qualification."
  },
  {
    entityType: "DEAL",
    name: "Data Migration Required",
    key: "data_migration_required",
    fieldType: "BOOLEAN",
    use: "Flag whether data migration planning belongs in scope."
  },
  {
    entityType: "DEAL",
    name: "Environment Count",
    key: "environment_count",
    fieldType: "NUMBER",
    use: "Capture development, test, UAT, staging, and production complexity."
  },
  {
    entityType: "DEAL",
    name: "Testing / UAT Required",
    key: "testing_uat_required",
    fieldType: "BOOLEAN",
    use: "Expose testing and UAT planning needs."
  },
  {
    entityType: "DEAL",
    name: "Executive Sponsor Identified",
    key: "executive_sponsor_identified",
    fieldType: "BOOLEAN",
    use: "Show whether executive sponsorship has been confirmed."
  },
  {
    entityType: "DEAL",
    name: "Operations Sponsor Identified",
    key: "operations_sponsor_identified",
    fieldType: "BOOLEAN",
    use: "Show whether operations sponsorship has been confirmed."
  },
  {
    entityType: "DEAL",
    name: "IT Sponsor Identified",
    key: "it_sponsor_identified",
    fieldType: "BOOLEAN",
    use: "Show whether IT sponsorship has been confirmed."
  },
  {
    entityType: "DEAL",
    name: "Risk Level",
    key: "risk_level",
    fieldType: "SELECT",
    options: ["Low", "Medium", "High"],
    use: "Summarize delivery or commercial risk for sales review."
  },
  {
    entityType: "DEAL",
    name: "Operational Pain Area",
    key: "operational_pain_area",
    fieldType: "SELECT",
    options: ["Labor", "Inventory Accuracy", "Throughput", "Picking", "Slotting", "Receiving", "Returns", "Shipping", "Replenishment", "Integrations", "Reporting"],
    use: "Connect the sale to the operational problem the customer needs solved."
  },
  {
    entityType: "DEAL",
    name: "Success Metric / ROI Driver",
    key: "success_metric_roi_driver",
    fieldType: "TEXT",
    use: "Capture the business outcome that justifies the project."
  },
  {
    entityType: "DEAL",
    name: "Support Needed After Go-Live",
    key: "support_needed_after_go_live",
    fieldType: "BOOLEAN",
    use: "Identify support retainers and optimization follow-on opportunities."
  }
];

export const supplyChainOrganizationFieldTemplates: VerticalCustomFieldTemplate[] = [
  {
    entityType: "ORGANIZATION",
    name: "Industry",
    key: "industry",
    fieldType: "SELECT",
    options: ["Retail", "CPG", "Grocery", "Apparel", "Food / Beverage", "3PL", "Wholesale", "Manufacturing", "Logistics", "Healthcare", "Industrial"],
    use: "Segment account context by operating model."
  },
  {
    entityType: "ORGANIZATION",
    name: "Account Tier",
    key: "account_tier",
    fieldType: "SELECT",
    options: ["Strategic", "Growth", "Standard"],
    use: "Prioritize account management and expansion effort."
  },
  {
    entityType: "ORGANIZATION",
    name: "Warehouse / DC Count",
    key: "warehouse_dc_count",
    fieldType: "NUMBER",
    use: "Capture facility/network scale without adding a facility model."
  },
  {
    entityType: "ORGANIZATION",
    name: "Region / Geography",
    key: "region_geography",
    fieldType: "TEXT",
    use: "Record the account's operating geography."
  },
  {
    entityType: "ORGANIZATION",
    name: "Current WMS",
    key: "current_wms",
    fieldType: "TEXT",
    use: "Keep account-level system landscape visible."
  },
  {
    entityType: "ORGANIZATION",
    name: "Current OMS",
    key: "current_oms",
    fieldType: "TEXT",
    use: "Keep account-level system landscape visible."
  },
  {
    entityType: "ORGANIZATION",
    name: "Current ERP",
    key: "current_erp",
    fieldType: "TEXT",
    use: "Keep account-level system landscape visible."
  },
  {
    entityType: "ORGANIZATION",
    name: "Current TMS",
    key: "current_tms",
    fieldType: "TEXT",
    use: "Keep account-level system landscape visible."
  },
  {
    entityType: "ORGANIZATION",
    name: "Current Support Model",
    key: "current_support_model",
    fieldType: "TEXT",
    use: "Capture whether support is internal, vendor-led, partner-led, or mixed."
  },
  {
    entityType: "ORGANIZATION",
    name: "Omnichannel Fulfillment",
    key: "omnichannel_fulfillment",
    fieldType: "BOOLEAN",
    use: "Flag accounts with omnichannel fulfillment complexity."
  },
  {
    entityType: "ORGANIZATION",
    name: "Distribution Complexity",
    key: "distribution_complexity",
    fieldType: "SELECT",
    options: ["Low", "Medium", "High"],
    use: "Prioritize strategic and higher-effort accounts."
  },
  {
    entityType: "ORGANIZATION",
    name: "Expansion Potential",
    key: "expansion_potential",
    fieldType: "SELECT",
    options: ["Low", "Medium", "High"],
    use: "Mark accounts likely to need optimization, rollout, or support expansion."
  },
  {
    entityType: "ORGANIZATION",
    name: "Existing Customer",
    key: "existing_customer",
    fieldType: "BOOLEAN",
    use: "Identify expansion, renewal, support, and optimization paths."
  },
  {
    entityType: "ORGANIZATION",
    name: "Vendor Ecosystem Notes",
    key: "vendor_ecosystem_notes",
    fieldType: "TEXT",
    use: "Summarize important software vendor or partner relationships."
  }
];

export const supplyChainLeadFieldTemplates: VerticalCustomFieldTemplate[] = [
  {
    entityType: "LEAD",
    name: "Inquiry Type",
    key: "inquiry_type",
    fieldType: "SELECT",
    options: ["Advisory", "Software Selection", "Implementation Partner", "Optimization", "Support", "Upgrade", "Tooling / Accelerator"],
    use: "Route inbound demand into the right qualification path."
  },
  {
    entityType: "LEAD",
    name: "Current System",
    key: "current_system",
    fieldType: "TEXT",
    use: "Capture known incumbent technology during lead qualification."
  },
  {
    entityType: "LEAD",
    name: "Target System",
    key: "target_system",
    fieldType: "TEXT",
    use: "Capture the desired or candidate platform if known."
  },
  {
    entityType: "LEAD",
    name: "Timeline",
    key: "timeline",
    fieldType: "TEXT",
    use: "Record buying, go-live, or support urgency."
  },
  {
    entityType: "LEAD",
    name: "Budget Confidence",
    key: "budget_confidence",
    fieldType: "SELECT",
    options: ["Low", "Medium", "High"],
    use: "Qualify whether the lead has credible funding."
  },
  {
    entityType: "LEAD",
    name: "Primary Operational Pain",
    key: "primary_operational_pain",
    fieldType: "TEXT",
    use: "Record the pain before discovery turns it into a scoped opportunity."
  },
  {
    entityType: "LEAD",
    name: "Urgency",
    key: "urgency",
    fieldType: "SELECT",
    options: ["Low", "Medium", "High"],
    use: "Separate urgent support or go-live needs from early exploration."
  },
  {
    entityType: "LEAD",
    name: "Facility Count",
    key: "facility_count",
    fieldType: "NUMBER",
    use: "Estimate customer scale during qualification."
  },
  {
    entityType: "LEAD",
    name: "Needs Software Selection",
    key: "needs_software_selection",
    fieldType: "BOOLEAN",
    use: "Flag leads that need advisory selection help."
  },
  {
    entityType: "LEAD",
    name: "Needs Implementation Partner",
    key: "needs_implementation_partner",
    fieldType: "BOOLEAN",
    use: "Flag leads seeking implementation delivery help."
  },
  {
    entityType: "LEAD",
    name: "Needs Support",
    key: "needs_support",
    fieldType: "BOOLEAN",
    use: "Flag leads seeking managed support or urgent assistance."
  },
  {
    entityType: "LEAD",
    name: "Needs Optimization",
    key: "needs_optimization",
    fieldType: "BOOLEAN",
    use: "Flag leads seeking operational or system tuning."
  },
  {
    entityType: "LEAD",
    name: "Decision Maker Known",
    key: "decision_maker_known",
    fieldType: "BOOLEAN",
    use: "Expose leads that need stakeholder discovery."
  }
];

export const supplyChainSavedViewRecommendations: VerticalSavedViewRecommendation[] = [
  { recordType: "DEAL", name: "Advisory / Planning Opportunities", filterHint: "Opportunity Type equals Advisory" },
  { recordType: "DEAL", name: "Software Selection Opportunities", filterHint: "Opportunity Type equals Software Selection" },
  { recordType: "DEAL", name: "Implementation Opportunities", filterHint: "Opportunity Type equals Implementation" },
  { recordType: "DEAL", name: "Optimization Opportunities", filterHint: "Opportunity Type equals Optimization" },
  { recordType: "DEAL", name: "Support Opportunities", filterHint: "Opportunity Type equals Support" },
  { recordType: "DEAL", name: "Upgrade Opportunities", filterHint: "Opportunity Type equals Upgrade" },
  { recordType: "DEAL", name: "Tooling / Accelerator Opportunities", filterHint: "Opportunity Type equals Accelerator / Tooling" },
  { recordType: "DEAL", name: "High-Risk Opportunities", filterHint: "Risk Level equals High" },
  { recordType: "DEAL", name: "Go-Live This Quarter", filterHint: "Go-Live Target Date within the current quarter" },
  { recordType: "DEAL", name: "Deals Missing Next Activity", filterHint: "Use existing deal attention for missing next activity" },
  { recordType: "DEAL", name: "Deals Missing Go-Live Date", filterHint: "Go-Live Target Date is empty" },
  { recordType: "DEAL", name: "Deals with High Integration Complexity", filterHint: "Integration Complexity equals High" },
  { recordType: "DEAL", name: "Active SOW / Contracting Deals", filterHint: "Contract/SOW status is in progress, sent, or blocked" },
  { recordType: "DEAL", name: "Existing Customer Expansion Deals", filterHint: "Existing Customer or Expansion Potential indicates expansion" },
  { recordType: "LEAD", name: "Leads Needing Discovery", filterHint: "Status is New or Qualified and Inquiry Type is known" },
  { recordType: "LEAD", name: "Leads Needing Software Selection", filterHint: "Needs Software Selection is true" },
  { recordType: "LEAD", name: "Leads Needing Implementation Partner", filterHint: "Needs Implementation Partner is true" },
  { recordType: "LEAD", name: "Leads Needing Support", filterHint: "Needs Support is true" },
  { recordType: "LEAD", name: "Leads with Urgent Timeline", filterHint: "Urgency equals High" },
  { recordType: "LEAD", name: "Leads Missing Decision Maker", filterHint: "Decision Maker Known is empty or false" },
  { recordType: "ORGANIZATION", name: "Strategic Accounts", filterHint: "Account Tier equals Strategic or Expansion Potential equals High" },
  { recordType: "ORGANIZATION", name: "Accounts with Multiple Facilities", filterHint: "Warehouse / DC Count is greater than 1" }
  ,
  { recordType: "ORGANIZATION", name: "Accounts by Current Platform", filterHint: "Current WMS, OMS, ERP, or TMS is known" },
  { recordType: "ORGANIZATION", name: "Accounts with Expansion Potential", filterHint: "Expansion Potential equals High" },
  { recordType: "ORGANIZATION", name: "Existing Customers", filterHint: "Existing Customer is true" },
  { recordType: "ORGANIZATION", name: "High-Complexity Distribution Networks", filterHint: "Distribution Complexity equals High" }
];

export const supplyChainServiceCatalogExamples = [
  "Supply Chain Systems Advisory",
  "Current-State Operations Assessment",
  "Warehouse Process Diagnostic",
  "Implementation Readiness Assessment",
  "Software Selection Workshop",
  "Business Case / ROI Workshop",
  "Roadmap Planning Engagement",
  "WMS / OMS Implementation Assessment",
  "Solution Design Package",
  "System Configuration Package",
  "Integration Planning Package",
  "Data Migration Planning",
  "UAT / Testing Support",
  "Go-Live Planning",
  "Go-Live Support",
  "Stabilization / Hypercare Support",
  "Multi-Site Rollout Planning",
  "Process and System Optimization Assessment",
  "Labor / Throughput Improvement Review",
  "Inventory Accuracy Improvement Review",
  "Managed Support Retainer",
  "Upgrade Readiness Assessment",
  "Post-Go-Live Optimization Review",
  "Configuration Migration Assessment",
  "Automated Testing Enablement",
  "Environment Comparison Setup",
  "File Deployment / Versioning Enablement",
  "Implementation Accelerator Package"
];

export const supplyChainActivityNameExamples = [
  "Discovery Call",
  "Current-State Review",
  "Warehouse Process Walkthrough",
  "Requirements Workshop",
  "Software Selection Workshop",
  "Integration Review",
  "Data Migration Review",
  "Testing / UAT Planning",
  "Go-Live Readiness Review",
  "Stabilization Check-In",
  "Optimization Review",
  "Support Follow-Up",
  "SOW Review"
];

export const supplyChainDashboardQuestions = [
  "Which implementation or support deals need attention?",
  "Which deals are missing a next activity?",
  "Which opportunities are high risk or high integration complexity?",
  "Which opportunities are approaching a go-live target?",
  "Which SOWs or contract steps need action?",
  "Which accounts have expansion or optimization potential?"
];

export const supplyChainDeferredBoundaries = [
  "No WMS, OMS, ERP, TMS, LMS, WES, inventory, shipment, or warehouse execution integration.",
  "No full project-management, resource-planning, helpdesk, or support-ticketing subsystem.",
  "No facility/site schema, document generation, e-signature, or advanced custom-field analytics in this vertical pass."
];
