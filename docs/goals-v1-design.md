# Goals v1 Design

Status: Reports UI MVP implemented. Close outcome timestamp readiness is implemented with `Deal.wonAt` and `Deal.lostAt`, workspace-level monthly won-revenue goal targets exist behind service functions, and `/reports` now includes a small table-first Goals v1 section.

## Objective

Goals v1 should answer: "Are we on track against a simple sales target for this period?"

The primary users are workspace owners, admins, and sales operators who already use `/reports` for Deal Reporting v1 and Forecasting v1. Goals v1 should remain a lightweight operating view, not a compensation, quota-management, or forecasting engine.

Goals v1 explicitly does not cover personal quota plans, teams, visibility groups, leaderboards, commissions, forecasting categories, saved reports, scheduled reports, notifications, automations, charts, external integrations, or background jobs.

## Current Reporting And Data Model Findings

Available now:

- `Deal.status` supports `OPEN`, `WON`, and `LOST`.
- `Deal.valueCents` and `Deal.currency` support deal value reporting.
- `Deal.ownerId` exists and can attribute a deal to a current user.
- `Deal.expectedCloseAt` exists and powers open-deal forecasting.
- `Deal.wonAt` and `Deal.lostAt` now persist actual won/lost timing for deals closed after the timestamp-readiness migration.
- `Goal` stores workspace-level monthly won-revenue targets with `GoalType.WON_REVENUE`, period start/end, currency, and target cents.
- `PipelineStage.probability` exists for weighted open forecast calculations.
- `Activity.completedAt` exists and can support completed-activity period calculations.
- Workspace membership roles exist for workspace-level administration boundaries.

Important gaps:

- Deals closed before the close-timestamp migration can have null `wonAt`/`lostAt` because there is no safe historical backfill source.
- `Deal` does not persist lost reason as a queryable field; lost reason currently lives only in audit metadata.
- Goals v1 has a `/reports` section and server-action form, but no dashboard widget, standalone route, public API route, notification, or automation exists yet.
- No goal ownership, assignment, or target count storage exists.
- No goal progress snapshots/history exist.
- No team hierarchy or visibility-group model exists.

Runtime goals are intentionally limited to the `/reports` MVP. Won-revenue progress uses `wonAt`, and treats legacy closed deals with null close timing as outside period-safe progress unless a separate data backfill is designed. `createdAt`, `updatedAt`, and `expectedCloseAt` should not be used as substitutes for actual close date because they would produce misleading period progress.

## MVP Goal Type Recommendation

The smallest valuable first goal type should be:

- Workspace-level won revenue goal.
- Period: calendar month first; calendar quarter can follow using the same primitives.
- Progress source: `WON` deals whose persisted actual won date falls inside the period.
- Value source: `Deal.valueCents` and `Deal.currency` at calculation time, with a clear no-FX policy.

This is the right first goal because it matches the current sales operating model and the `/reports` surface. Close timing, target storage, progress service, and the smallest Reports UI now exist.

Deferred goal types:

- Won deal count: useful and can share the same close-date foundation, but should follow won revenue.
- Activity completion: technically easier because `Activity.completedAt` exists, but it needs goal target storage and is less connected to current revenue reporting.
- Pipeline creation: not recommended for v1 because "created pipeline" can encourage noisy behavior and does not answer revenue attainment.

## Scope Rules

Goals v1 should start workspace-level only:

- One workspace goal per currency and period for the MVP.
- No per-owner targets in the first implementation.
- No team goals, role-based quotas, or visibility groups.
- Workspace admins/owners can manage monthly goal targets from Reports; normal members can view goal progress according to existing report access patterns.

Period rules:

- Monthly period first, using the workspace/app server timezone consistently with existing reporting.
- Store period start and period end as explicit dates/timestamps rather than deriving from a label only.
- Treat the start as inclusive and the end as exclusive.
- Quarter support can be derived later from the same period boundaries.

Currency rules:

- Do not convert currencies.
- A goal target has a single currency.
- Won deals contribute only to goals with the same currency.
- Multi-currency workspaces need separate goals per currency or a clear "not included" message.

Owner attribution:

- Defer owner/user goals in v1.
- If owner goals are later added, use the deal owner at the time of win. A durable `closedOwnerId` or goal-contribution snapshot may be needed before user-level goals are accurate.

## Data Requirements For Accurate Goals

Implemented close-timestamp readiness:

- `Deal.wonAt DateTime?` and `Deal.lostAt DateTime?` are persisted.
- Closing a deal as `WON` sets `wonAt` and clears `lostAt`.
- Closing a deal as `LOST` sets `lostAt` and clears `wonAt`.
- Reopening a closed deal clears both outcome timestamps.
- Existing closed deals are not backfilled and can remain null.

Implemented target/service readiness:

- `Goal` stores one monthly `WON_REVENUE` target per workspace/currency/month.
- `createOrUpdateMonthlyWonRevenueGoal` creates or updates the target for the normalized month.
- Goal targets are validated against the current integer-cent storage limit before writing.
- `getMonthlyWonRevenueGoalProgress` sums same-currency `WON` deals with `wonAt >= periodStart` and `wonAt < periodEnd`.
- Progress excludes `OPEN`/`LOST` deals, cross-workspace deals, and legacy `WON` deals with null `wonAt`.
- No FX conversion is applied.

Implemented UI readiness:

- `/reports` includes a `Goals v1` section.
- A simple server-action form creates or updates one monthly won-revenue goal for the selected currency.
- A table shows month, currency, target, won revenue, remaining amount, progress percent, and included deal count.
- Copy states that this is workspace-level monthly won-revenue only; progress uses same-currency `WON` deals whose actual won timestamp (`wonAt`) falls inside the selected month, not expected close date; legacy won deals with null `wonAt` are excluded; and no FX conversion is applied.

Nice-to-have but not required for workspace-level v1:

- `lostReason` as a queryable deal field for later lost analysis.
- `closedOwnerId` or goal contribution snapshots for owner-level quotas.
- Goal progress snapshots/history for reporting how progress changed over time.

Activity goals would need:

- Goal target storage.
- A clear rule that completed activities count by `Activity.completedAt`.
- Owner attribution from `Activity.ownerId`.
- Workspace scoping and soft-delete exclusion.

## Proposed UX

Placement:

- Goals v1 should live on `/reports` near Deal Reporting v1 and Forecasting v1.
- Do not add dashboard widgets for the first implementation; the dashboard should remain a lightweight health view.
- Do not add a separate goals page until there is goal management, history, or owner-level detail.

Suggested read-only section labels:

- Section title: `Goals v1`
- Helper copy: `Workspace-level monthly won-revenue goal only. Progress uses same-currency WON deals whose actual won timestamp (wonAt) falls inside the selected month, not expected close date. Legacy won deals without wonAt are excluded. Same currency only; no FX conversion is applied.`
- Metric labels:
  - `Target`
  - `Won this period`
  - `Remaining`
  - `Progress`
  - `Included deals`

Empty states:

- No goals configured: `No goals are configured yet. Add a monthly won-revenue target before progress can be tracked.`
- No closed-won deals in period: `No won deals have an actual won date in this goal period yet.`
- Missing goal target: `No monthly target saved yet.`
- Multi-currency: `Goals do not convert currency. Create separate goals for each currency.`

Progress display:

- Table-first summary, no charts required.
- Show target, actual won value, remaining value, percent progress, period, and currency.
- Link included deals only if it can use existing Deals list state without pretending `wonAt` filtering exists.

## Future Tests

Source/API tests:

- Goal calculation includes only records in the current workspace.
- Won revenue includes only `WON` deals with `wonAt >= periodStart` and `wonAt < periodEnd`.
- `OPEN` and `LOST` deals do not contribute.
- Reopened deals no longer contribute after their won timestamp is cleared.
- Values are grouped or matched by currency with no FX conversion.
- Zero-value won deals count deterministically if zero-value deals remain allowed.
- Soft-deleted deals do not contribute.

Integration tests:

- Closing a deal as won sets the won timestamp.
- Losing a deal sets the lost timestamp and does not count toward won revenue.
- Reopening a won deal clears the won timestamp and removes it from progress.
- Cross-workspace deals are excluded.
- Manual accepted-quote sync changes goal progress only through the deal value field and only when the deal is won in the goal period.

Browser smoke:

- `/reports` smoke asserts the visible `Goals v1` section and wonAt progress copy.

## Recommended Next Slice

Goals v1 design, schema/service foundation, Reports UI MVP, validation/copy hardening, and the admin/owner goal-management boundary are implemented. Future slices should stay focused unless product requirements change. Do not add charts, dashboard widgets, owner/user/team goals, quarterly goals, activity goals, saved/scheduled reports, notifications, automations, background jobs, API routes, or FX conversion as part of readiness cleanup.
