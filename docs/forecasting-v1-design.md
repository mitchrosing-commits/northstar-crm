# Forecasting v1 Design

Status: implemented MVP. Forecasting v1 is available as a table-first section on `/reports` using existing schema only.

## Objective

Forecasting v1 should answer: "What open pipeline value is expected to close in a chosen period, and how much of it is weighted by current stage probability?"

Primary users are sales owners, founders, and workspace admins reviewing short-term pipeline coverage. The first version is a lightweight operational view, not a forecasting engine.

Forecasting v1 explicitly does not cover goal progress, quotas, forecast categories, commit/best-case calls, forecast history, snapshots, saved reports, scheduled reports, new charts, automations, notifications, or external integrations.

Implemented MVP behavior:

- Includes active, workspace-scoped `OPEN` deals only.
- Excludes `WON` and `LOST` deals from forecast totals.
- Groups summary totals by deal currency and applies no FX conversion.
- Calculates unweighted open forecast value from `Deal.valueCents ?? 0`.
- Calculates weighted forecast value only when `PipelineStage.probability` is non-null.
- Separately reports missing stage probability count/value and no expected close date count/value.
- Renders deal-level forecast rows with deal, pipeline/stage, owner, expected close date, open value, stage probability, and weighted value.

## Current Data Inputs

- Open deal value: `Deal.valueCents` and `Deal.currency`.
- Deal status: `Deal.status` supports `OPEN`, `WON`, and `LOST`.
- Pipeline and stage: `Deal.pipelineId`, `Deal.stageId`, `Pipeline`, and `PipelineStage`.
- Stage probability: `PipelineStage.probability Int?` exists and is validated by stage API schemas as an optional `0..100` integer.
- Expected close date: `Deal.expectedCloseAt DateTime?` exists and is supported by deal create/edit/import/export/list sorting.
- Owner: `Deal.ownerId` exists and resolves to the existing safe display user select through deal services.
- Quote-derived value: accepted quote totals affect forecasting only after a user manually syncs the accepted quote to `Deal.valueCents` and `Deal.currency`.
- Products and line items: `DealLineItem` and `QuoteItem` exist, but line-item totals intentionally do not overwrite `Deal.valueCents`; they should be deferred as direct forecast inputs.

## Forecast Calculations

Forecasting v1 should include only active, workspace-scoped `OPEN` deals. `WON` and `LOST` deals should be excluded from forecast totals; they may remain available in existing Deal Reporting v1 metrics.

Recommended metrics:

- Unweighted forecast value: sum of `Deal.valueCents ?? 0` for included open deals.
- Open deal count: count of included open deals.
- Weighted forecast value: sum of `deal.valueCents * stage.probability / 100` only for deals whose current stage has a non-null probability.
- Missing stage probability value: sum of open deal value where `PipelineStage.probability` is null.
- No expected close date value/count: open deals with no `expectedCloseAt`.

Date windows should use `Deal.expectedCloseAt`:

- Default window: current calendar quarter if a local helper already exists by implementation time; otherwise next 90 days is acceptable and simpler.
- Supported filter: `expectedCloseAt` from start date inclusive to end date exclusive.
- Deals without `expectedCloseAt` should not be silently mixed into dated forecast totals. Show them separately as "No expected close date."
- Overdue open deals with `expectedCloseAt` before the window should be shown as a separate hygiene bucket, not counted in the selected-period forecast unless the user chooses an overdue/all-open view.

Currency handling:

- Current reports format a single currency value through `formatMoney`. Forecasting v1 should initially use the existing deal currency behavior and avoid cross-currency conversion.
- If multiple currencies appear in the result set, either group by currency or show a clear "multiple currencies" limitation. Do not add FX rates.

## Required Data-Model Findings And Gaps

Available now:

- Stage probability exists as `PipelineStage.probability Int?`.
- Expected close date exists as `Deal.expectedCloseAt DateTime?`.
- Close outcome timestamps exist as `Deal.wonAt DateTime?` and `Deal.lostAt DateTime?`, but Forecasting v1 remains open-deal-only and does not use closed-deal timing.
- Owner exists as `Deal.ownerId`.
- Pipeline/stage relationships exist and are workspace-scoped.
- Deal value/currency exists as `Deal.valueCents` and `Deal.currency`.
- Goals v1 exists on `/reports` as a separate workspace-level monthly won-revenue section using `wonAt`; Forecasting v1 does not calculate against goals or quotas.

Gaps:

- Lost reason is audit metadata only from the close action and is not persisted as a queryable deal field.
- Forecast snapshots/history do not exist.
- Forecast categories such as commit, best case, and omitted do not exist.
- Team hierarchy or visibility groups do not exist.
- Stage probability has service/API support, but no broad pipeline-admin probability-editing UX should be assumed for Forecasting v1.

Forecasting v1 can remain schema-stable as long as it stays an open-deal forecast using current `expectedCloseAt`, `stage.probability`, owner, pipeline, stage, value, and currency. Additional schema or service work would be needed for lost-reason analysis, forecast history/snapshots, forecast categories, team rollups, or goal-integrated forecasting.

## MVP Constraints

- No new charting library.
- No goal/forecast blending or quota allocation.
- No saved reports.
- No scheduled reports.
- No forecast history or snapshots.
- No background jobs.
- No probability editing unless an existing pipeline/stage admin surface is intentionally extended in a separate slice.
- No quote or line-item calculation changes.
- No automatic quote-to-deal sync.
- No changes to deal close/reopen semantics.

## Proposed UX

Forecasting v1 should live on the existing `/reports` page as a new table-first section below the current Deal Reporting v1 summary. A separate `/forecast` page would be premature, and the dashboard should stay a lightweight health overview.

Suggested labels:

- Section title: `Forecasting v1`
- Helper copy: `Open deals grouped by expected close date, pipeline, stage, owner, and optional stage probability.`
- Metrics:
  - `Open forecast value`
  - `Weighted forecast value`
  - `Open forecast deals`
  - `No expected close date`
  - `No stage probability`
- Table columns:
  - `Deal`
  - `Pipeline / Stage`
  - `Owner`
  - `Expected close`
  - `Open value`
  - `Stage probability`
  - `Weighted value`

Suggested filters:

- Date window: all open, current quarter, next 30 days, next 90 days, or explicit start/end if the existing list-state helpers make it cheap.
- Pipeline.
- Owner.
- Stage only if pipeline filtering already makes the stage list unambiguous.

Empty states:

- No open deals: `No open deals are available for forecasting yet.`
- Date window empty: `No open deals have expected close dates in this forecast window.`
- Missing stage probability: `Missing stage probability means a deal is in a stage with no probability set, so that deal is not included in weighted forecast value.`
- Missing expected close dates: `No expected close date means the deal has no expected close date set and is shown outside dated forecast planning.`

## Implemented Test Coverage And Future Hardening

Source/API tests:

- Forecast service includes `ensureWorkspaceAccess(actor)` and workspace filters.
- Forecast service filters to `DealStatus.OPEN`.
- Unweighted forecast sums `valueCents ?? 0`.
- Weighted forecast uses `PipelineStage.probability` only when non-null.
- Deals without expected close dates are separated from dated totals.
- `WON` and `LOST` deals are excluded from forecast totals.
- Quote totals affect forecast only after accepted-quote sync changes `Deal.valueCents`.
- Reports page renders the Forecasting v1 section without charts/builders.

Integration tests:

- Open deals inside a date window contribute to unweighted and weighted totals.
- Open deals outside the date window are excluded from dated totals.
- Open deals without expected close dates appear in the no-close-date bucket.
- Closed deals do not contribute.
- Cross-workspace deals/stages/owners do not contribute.
- Multi-currency behavior is deterministic and clearly grouped or flagged.

Browser smoke:

- Keep browser smoke to one stable Forecasting v1 assertion on `/reports`; avoid fragile table-layout or responsive visual assertions.

## Recommended Next Slice

Forecasting v1 is implemented. A future slice should stay validation-focused unless product requirements change: test more real-world open-pipeline samples, verify stage-probability copy with users, and keep forecasting separate from Goals v1 until a deliberate goal/forecast design exists. Do not add charts, saved reports, scheduled reports, forecast history, background jobs, schema changes, quote auto-sync, direct line-item forecast inputs, or probability editing as part of a cleanup pass.
