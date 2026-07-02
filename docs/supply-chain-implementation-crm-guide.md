# Supply-chain implementation CRM guide

This guide explains how to configure Northstar CRM for a company that sells supply-chain software consulting, warehouse/distribution system implementation, operational optimization, managed support, and implementation accelerators. Northstar should remain a CRM: it tracks account context, opportunity qualification, commercial workflow, next steps, quotes, and contract progress. It should not become a WMS, OMS, project-management tool, helpdesk, or integration middleware.

## Target Business Model

Use this setup for teams that sell and deliver:

- Advisory and planning: discovery, current-state review, process mapping, requirements, business case, and roadmap planning.
- Software selection: WMS, OMS, ERP-adjacent, TMS, LMS, WES, reporting, integration, automation, and deployment-model evaluation.
- Implementation: solution design, configuration, integration planning, data migration, testing, UAT, rollout planning, go-live, stabilization, and handoff.
- Optimization and support: process improvement, throughput/labor/inventory accuracy work, urgent support, managed support retainers, upgrade assistance, and post-go-live optimization.
- Productized tools or accelerators: configuration migration, automated testing enablement, environment comparison, file deployment/versioning, and implementation accelerators.

## Common Customer Types

- Retail, ecommerce, omnichannel, wholesale, 3PL, grocery, CPG, apparel, manufacturing, logistics, healthcare, food/beverage, and industrial distribution businesses.
- Enterprise accounts with multiple facilities, multiple regions, legacy systems, external vendors, and phased rollouts.
- Existing customers that need support, upgrades, optimization, additional sites, or new system modules.

## Common Stakeholders

Track stakeholders as contacts on the organization and related deals. Useful roles include executive sponsor, operations sponsor, IT sponsor, warehouse operations leader, finance/procurement contact, software vendor contact, implementation partner contact, technical evaluator, decision maker, go-live owner, and support owner.

## Recommended Pipeline Structure

Document these stages as a vertical pipeline option. Do not force them into existing workspaces unless a team intentionally changes its pipeline settings.

1. Qualified Lead
2. Discovery / Advisory
3. Requirements / Current State
4. Software Selection
5. Solution Design
6. Proposal / SOW
7. Contracting
8. Implementation Scheduled
9. Won / Active Delivery
10. Lost / Deferred

Keep delivery execution outside the CRM. Use the final won state and notes/activities for handoff context, not project task management.

## Recommended Deal Types

- Advisory / planning opportunity
- Software selection engagement
- Implementation opportunity
- Optimization opportunity
- Support or hypercare opportunity
- Upgrade readiness opportunity
- Tooling / accelerator opportunity
- Existing-customer expansion opportunity

## Recommended Custom Fields

Create only fields the team will actually maintain. Start with a small set, then add more once the workflow is stable.

Northstar Settings includes an optional supply-chain implementation setup action that can create these recommended fields idempotently. Running it again preserves existing fields and only fills missing presets.

### Deal Fields

| Field | Type | Options / Notes |
| --- | --- | --- |
| Opportunity Type | Select | Advisory, Software Selection, Implementation, Optimization, Support, Upgrade, Accelerator / Tooling |
| Service Line | Select | Planning, Selection, Design, Configuration, Integration, Testing, Go-Live, Stabilization, Support, Optimization |
| System Category | Select | WMS, OMS, ERP, TMS, LMS, WES, Reporting, Integration, Automation, Other |
| Current Platform | Text | Current system or incumbent vendor |
| Target Platform | Text | Planned or selected platform |
| Deployment Model | Select | Cloud, On-Premise, Hybrid, Undecided |
| Facility Count | Number | Use when account-level facility count is not enough |
| Distribution Network Scope | Text | Regions, business units, or facility groups impacted |
| Omnichannel Fulfillment | Boolean | Yes/no |
| Project Phase | Select | Discovery, Selection, Design, Build, Test, UAT, Go-Live, Stabilization, Support |
| Go-Live Target Date | Date | Timing signal for risk and SOW urgency |
| Decision Timeline | Text | Buying or steering-committee timeline |
| Operational Pain Area | Select | Labor, Inventory Accuracy, Throughput, Picking, Slotting, Receiving, Returns, Shipping, Replenishment, Integrations, Reporting |
| Data Migration Required | Boolean | Yes/no |
| Integration Complexity | Select | Low, Medium, High |
| Environment Count | Number | Development/test/UAT/staging/production count if known |
| Testing / UAT Required | Boolean | Yes/no |
| Executive Sponsor Identified | Boolean | Yes/no |
| Operations Sponsor Identified | Boolean | Yes/no |
| IT Sponsor Identified | Boolean | Yes/no |
| Risk Level | Select | Low, Medium, High |
| Success Metric / ROI Driver | Text | Labor savings, throughput, inventory accuracy, service level, cost avoidance |
| Support Needed After Go-Live | Boolean | Yes/no |

### Organization / Account Fields

| Field | Type | Options / Notes |
| --- | --- | --- |
| Industry | Select | Retail, CPG, Grocery, Apparel, Food / Beverage, 3PL, Wholesale, Manufacturing, Logistics, Healthcare, Industrial |
| Account Tier | Select | Strategic, Growth, Standard |
| Warehouse / DC Count | Number | Account scale without adding a facility model |
| Region / Geography | Text | Country, region, or operating footprint |
| Current WMS | Text | Account-level system landscape |
| Current OMS | Text | Account-level system landscape |
| Current ERP | Text | Account-level system landscape |
| Current TMS | Text | Account-level system landscape |
| Current Support Model | Text | Internal, vendor, partner, managed support, mixed |
| Omnichannel Fulfillment | Boolean | Yes/no |
| Distribution Complexity | Select | Low, Medium, High |
| Expansion Potential | Select | Low, Medium, High |
| Existing Customer | Boolean | Yes/no |
| Vendor Ecosystem Notes | Text | Important software/vendor relationships |

### Lead Fields

| Field | Type | Options / Notes |
| --- | --- | --- |
| Inquiry Type | Select | Advisory, Software Selection, Implementation Partner, Optimization, Support, Upgrade, Tooling / Accelerator |
| Current System | Text | Known incumbent system |
| Target System | Text | Known target or preferred platform |
| Timeline | Text | Urgency or buying window |
| Budget Confidence | Select | Low, Medium, High |
| Primary Operational Pain | Text | Plain-language problem statement |
| Urgency | Select | Low, Medium, High |
| Facility Count | Number | Rough scale during qualification |
| Needs Software Selection | Boolean | Yes/no |
| Needs Implementation Partner | Boolean | Yes/no |
| Needs Support | Boolean | Yes/no |
| Needs Optimization | Boolean | Yes/no |
| Decision Maker Known | Boolean | Yes/no |

## Recommended Saved Views

Create saved views from filtered list pages after adding the relevant custom fields.

The Settings setup action creates only saved views that the current list-filter system can represent safely. Today that means date/boolean/text-supported custom-field filters such as missing go-live date, lead needs, current platform present, and existing-customer account views. Select-field saved views such as Opportunity Type equals Implementation are still recommended below, but remain deferred until custom-field list filtering supports `SELECT` values.

Deal views:

- Advisory / Planning Opportunities
- Software Selection Opportunities
- Implementation Opportunities
- Optimization Opportunities
- Support Opportunities
- Upgrade Opportunities
- Tooling / Accelerator Opportunities
- High-Risk Opportunities
- Go-Live This Quarter
- Deals Missing Next Activity
- Deals Missing Go-Live Date
- Deals with High Integration Complexity
- Active SOW / Contracting Deals
- Existing Customer Expansion Deals

Lead views:

- Leads Needing Discovery
- Leads Needing Software Selection
- Leads Needing Implementation Partner
- Leads Needing Support
- Leads with Urgent Timeline
- Leads Missing Decision Maker

Organization views:

- Strategic Accounts
- Accounts with Multiple Facilities
- Accounts by Current Platform
- Accounts with Expansion Potential
- Existing Customers
- High-Complexity Distribution Networks

Activity views to document for now:

- Use the Activities queue quick links for Overdue Follow-Ups, Due Today, Upcoming, No Due Date, and Completed Recently.
- Use Deal and Lead list `followUp` filters for Deals Missing Next Activity, Deals with Overdue Activity, Deals Due Today, Leads Missing Next Activity, and Leads Due Today.
- Continue documenting named vertical activity examples such as Upcoming Discovery Calls, Go-Live Readiness Reviews, Support Follow-Ups, and SOW Reviews.

Activity saved views should remain deferred until the `SavedViewRecordType` enum and activity list-state design explicitly support them.

Saved views are currently workspace-scoped. Per-user vertical saved views should be deferred until the saved-view model includes ownership.

## Dashboard Questions

Use the existing dashboard and reports to keep attention on practical consulting-sales questions:

- Which implementation or support deals need attention?
- Which deals are missing next activity?
- Which deals are high risk or high integration complexity?
- Which opportunities are approaching go-live?
- Which SOWs or contract steps need action?
- Which leads need discovery?
- Which accounts have expansion potential?
- Which support or optimization opportunities are overdue?
- How much open value is tied to implementation vs advisory vs support?

Do not add charting or complex custom-field analytics until these basic questions are stable.

## Activity Naming Conventions

Use consistent activity titles so activity lists and search remain useful:

- Discovery Call
- Current-State Review
- Warehouse Process Walkthrough
- Requirements Workshop
- Software Selection Workshop
- Solution Design Review
- Integration Review
- Data Migration Review
- Testing / UAT Planning
- Go-Live Readiness Review
- Stabilization Check-In
- Optimization Review
- Support Follow-Up
- SOW Review
- Executive Sponsor Check-In

## Example Follow-Up Cadence

Use activities as the next-action system for commercial and advisory work, not as delivery project tasks. Suggested examples:

- Discovery / advisory: schedule the discovery call, then a current-state recap or requirements workshop within one business week.
- Software selection: schedule evaluator follow-ups after requirements review, demo/vendor comparisons, and decision meetings.
- Implementation opportunity: schedule SOW review, integration-readiness review, data-migration review, and go-live readiness check-ins while the deal is open.
- Go-live / stabilization opportunity: schedule executive sponsor check-ins, stabilization review, and handoff notes after a won deal.
- Optimization / support: schedule support follow-up, optimization review, or expansion discovery on existing-customer accounts.

## Meeting Intelligence Examples

Use Meeting Intelligence when the team has meeting artifacts that should become CRM context after review. Good examples include discovery workshop notes, current-state warehouse process review notes, software selection workshops, implementation scoping calls, SOW review notes, go-live readiness meetings, stabilization/hypercare calls, optimization reviews, and support escalation calls.

The feature should help identify CRM-ready context such as current WMS/OMS/ERP/TMS, target platforms, facility count, distribution complexity, operational pain, integration complexity, data migration concerns, project phase, go-live timing, UAT, support/hypercare, stakeholders, sponsors, decision makers, budget/timeline signals, risks, open questions, SOW/MSA/NDA/proposal work, and next steps. It should propose evidence-backed notes for matched contacts, organizations, deals, and leads, plus completed meeting activity and follow-up activities that users can edit, exclude, or reassign before apply.

Keep the workflow review-first. Meeting Intelligence should not silently create records, overwrite fields, run project plans, manage tickets, store binary documents, or become a transcription product. Text-based PDFs and DOCX files can be extracted locally, but scanned PDFs, images, audio, and video should fail clearly with an OCR/transcription/provider requirement unless a reviewed provider integration is added.

Use the Activities queue for due/overdue work and the Deals/Leads follow-up filters to find records with no next activity. Keep implementation task breakdowns in the delivery system.

## Product / Service Catalog Examples

Use products as reusable service packages or pricing inputs, not retail SKUs:

The Settings setup action can create these examples as editable zero-price service templates. Teams should update pricing, descriptions, and active/inactive state before using them in quotes.

Advisory / planning:

- Supply Chain Systems Advisory
- Current-State Operations Assessment
- Warehouse Process Diagnostic
- Implementation Readiness Assessment
- Software Selection Workshop
- Business Case / ROI Workshop
- Roadmap Planning Engagement

Implementation:

- WMS / OMS Implementation Assessment
- Solution Design Package
- System Configuration Package
- Integration Planning Package
- Data Migration Planning
- UAT / Testing Support
- Go-Live Planning
- Go-Live Support
- Stabilization / Hypercare Support
- Multi-Site Rollout Planning

Optimization / support:

- Process and System Optimization Assessment
- Labor / Throughput Improvement Review
- Inventory Accuracy Improvement Review
- Managed Support Retainer
- Upgrade Readiness Assessment
- Post-Go-Live Optimization Review

Tooling / accelerators:

- Configuration Migration Assessment
- Automated Testing Enablement
- Environment Comparison Setup
- File Deployment / Versioning Enablement
- Implementation Accelerator Package

## Quote Patterns

- Quote services as phases or packages.
- Use line items for advisory, design, build/configuration, integration planning, testing, go-live, stabilization, and support.
- Keep assumptions, exclusions, milestones, environment scope, and support model in the SOW or quote notes.
- Preserve existing quote totals and accepted-quote sync behavior. Do not add billing, subscriptions, revenue recognition, or delivery forecasting in this vertical setup.

Use the deal commercial readiness panel during proposal review: line items should describe the scoped services, at least one quote should exist before proposal-stage review, customer context should be attached, and SOW status should be visible before close. Use the quote readiness panel as guidance for customer-facing quote review; it highlights missing items, zero totals, missing customer context, missing next activity, and blocked/not-started SOW state without creating a full CPQ or delivery-planning system.

## Contract Workflow Usage

Use the local NDA -> MSA -> SOW workflow as the commercial path:

- NDA: discovery, current-state review, system landscape discussion, and data-sharing permission.
- MSA: master services terms, support framework, security/privacy terms, and vendor/customer responsibilities.
- SOW: implementation phases, scope, assumptions, exclusions, milestones, environment responsibilities, go-live plan, support model, and acceptance criteria.

The SOW step is where implementation readiness, timeline, risk, and support handoff should be made explicit. Keep owner, due date, sent date, signed date, notes, and document reference current so pipeline reviews can spot blocked contracting work.

## Import / Export Usage

- Use CSV import for initial account, contact, lead, and deal loading after field definitions are agreed.
- Use exports for account reviews, service catalog review, pipeline hygiene, quote review, SOW/contract review, and handoff preparation.
- Use deal export commercial columns to spot open implementation deals with value but no scoped line items, no quote, stale quote state, or accepted quotes that still need explicit deal-value sync.
- The setup action creates field definitions only. Do not import custom field values until explicit mapping and validation are available.
- Keep external warehouse/system exports outside Northstar unless they are summarized as CRM context.

## Optional Setup Workflow

Use Settings -> Supply-chain implementation setup to review setup status and apply safe presets.

The setup action is intentionally idempotent:

- Custom fields: creates missing deal, lead, and organization field definitions with supported field types.
- Saved views: creates supported workspace-scoped list views only when the required fields exist and current filters can express the view.
- Service catalog: creates editable zero-price product templates for advisory, implementation, optimization, support, and accelerator services.
- Deferred items: reports Activity saved views, select-field saved-view filters, per-user saved views, and custom-field CSV import as unsupported rather than forcing schema changes.

Existing custom fields, saved views, products, quote totals, contract workflow rows, imports, exports, and workspace scoping are preserved.

## What Northstar Should Not Do Yet

De-emphasize or defer:

- Generic consumer-style lead scoring, social engagement tracking, high-volume cold outbound automation, and complex marketing attribution.
- Retail POS-style product selling, ecommerce order tracking, inventory-level warehouse operations, live shipment tracking, and field-service dispatch.
- Full project management, resource planning, helpdesk/support ticketing, and advanced analytics dashboards.
- WMS, OMS, ERP, TMS, LMS, WES, shipping, inventory, or facility integrations.
- Facility/site models, live operational data, document generation, e-signature, and custom workflow engines.

These boundaries keep Northstar focused on CRM work: account context, opportunity qualification, next activity, quote/service-package clarity, contract/SOW progress, and post-go-live expansion or support opportunities.
