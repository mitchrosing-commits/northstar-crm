# Activity List Usability Design

Status: Activity filter quick links implemented. Runtime Activity saved views, schema changes, migrations, reminders, calendar sync, recurrence, notifications, automations, background jobs, and integrations remain deferred.

## Objective

The next Activity list usability step should answer: "Can a sales user quickly return to the daily work queue view they need without adding a new activity system?"

Activities are manual CRM follow-ups. The list should stay focused on repeatable daily execution: open work, overdue work, today work, upcoming work, completed work, owner assignment, and related CRM context.

## Current Activity List Behavior

The Activities page uses URL-backed filters, but it does not use the generic saved-view list-state helpers used by Deals, Leads, Contacts, and Organizations.

Current URL/list inputs:

- `status`: `open` or `completed`.
- `due`: `overdue`, `today`, or `upcoming`.
- `ownerId`: workspace member user id.
- `related`: encoded as `deal:<id>`, `lead:<id>`, `person:<id>`, or `organization:<id>`.
- `sortBy`: `dueAt`, `createdAt`, `updatedAt`, or `title`.
- `sortDirection`: `asc` or `desc`.
- `page` and `pageSize`: handled by shared pagination parsing.

Current default behavior:

- No `status` filter means all active activities.
- No `due` filter means any due date, including unscheduled.
- Default sort is due-date oriented: open activities before completed activities, then `dueAt` ascending.
- `pageSize` defaults through shared pagination.

Due bucket semantics:

- `overdue` means open activities with `dueAt` before the start of today.
- `today` means open activities with `dueAt` from the start of today up to the start of tomorrow.
- `upcoming` means open activities with `dueAt` on or after the start of tomorrow.
- Due filters intentionally force `completedAt = null`, even when `status=completed` is also present.
- Unscheduled open activities are included in the work queue summary's open total, but there is no dedicated URL due bucket for unscheduled.

Current visible copy:

- Quick-link heading: `Quick activity links`.
- Quick-link labels: `My open`, `Overdue`, `Due today`, `Upcoming`, `Completed`.
- Quick-link helper copy: `Due quick links show open activities only.`
- Status labels: `Open activities`, `Completed activities`.
- Due labels: `Open overdue`, `Open due today`, `Open upcoming`.
- Helper copy: `Due filters show open activities only.`
- Empty filtered state: `No activities match these filters. Clear filters to return to the full work queue.`
- Empty unfiltered state: `No activities yet. Create an activity to plan the next call, email, meeting, or task.`

Current test coverage:

- Source tests pin Activity quick-link hrefs, Activity list labels, due-filter copy, empty states, sort controls, filter controls, and pagination controls.
- Integration tests pin work-queue summary counts by due/completion state.
- Integration tests pin filtering by status, due bucket, owner, related record, and workspace.

## Saved-View Feasibility

Activity saved views are feasible, but not as a no-migration slice.

The existing `SavedView` model can store entity-specific JSON state and already scopes records by `workspaceId` and `recordType`. However, `SavedViewRecordType` currently includes only:

- `DEAL`
- `LEAD`
- `PERSON`
- `ORGANIZATION`

It does not include `ACTIVITY`. Adding Activity saved views would require a Prisma migration to add `ACTIVITY` to `SavedViewRecordType`, plus an Activity list-state helper and service/panel/action wiring.

Migration impact:

- Add `ACTIVITY` to the Prisma enum.
- Generate the Prisma client.
- Existing saved views remain backward-compatible because existing enum values and rows are unchanged.
- The main compatibility risk is operational: production/dev databases must apply the enum migration before code paths can create `ACTIVITY` saved views.

Implementation fit:

- Activity list state is different from the core record lists because `related` is an encoded compound filter and Activities do not support custom field filters.
- Activity saved views should still exclude page number and persist `pageSize`.
- Saved views should normalize invalid `status`, `due`, `related`, `sortBy`, `sortDirection`, and `pageSize` safely.

Worth doing now?

Not yet. Activities already have a small, well-labeled work queue, and adding saved views would introduce schema work only to save a handful of common filters. A no-schema polish pass should come first.

## No-Schema Usability Options

Useful improvements that do not require schema changes:

- Add compact quick links above or near filters:
  - `My open`
  - `Overdue`
  - `Due today`
  - `Upcoming`
  - `Completed`
- Add an `Unscheduled` quick link or due bucket if daily workflow feedback shows it matters.
- Keep due-filter copy explicit that due buckets show open activities only.
- Improve active-filter summary copy if users have trouble seeing what is applied.
- Normalize/centralize Activity list-state constants in a small helper so future saved views have a cleaner foundation.
- Keep empty states split between no matching filters and no activities yet.

Avoid before schema work:

- Runtime Activity saved views.
- Query builder UI.
- Multi-filter saved-view builder.
- Recurrence, reminders, notifications, calendar sync, or automations.

## Recommendation

The recommended no-schema Activity filter quick-link polish is implemented.

Why:

- It improves the daily sales workflow immediately.
- It avoids a migration for a feature whose Activity-specific shape is still settling.
- It can reuse the current URL contract and existing filter semantics.
- It creates clearer evidence for whether full Activity saved views are worth the schema change.

Implemented scope:

- Keep current URL params and semantics unchanged.
- Add quick links for common Activity views using existing query params.
- Add source tests for quick-link hrefs and labels.
- Add a light browser smoke assertion for the quick-link panel.

Defer Activity saved views until:

- Users rely on several Activity views beyond the obvious quick links.
- The team is comfortable adding `ACTIVITY` to `SavedViewRecordType`.
- The Activity list-state helper exists and is already test-pinned.

## Future Saved-View Rules

If Activity saved views are implemented later:

- Use `SavedView.recordType = "ACTIVITY"` after an enum migration.
- Persist `status`, `due`, `ownerId`, `related`, `sortBy`, `sortDirection`, and `pageSize`.
- Exclude `page`.
- Do not add custom field filters to Activities.
- Normalize stale `related` values safely.
- Keep workspace and record-type scoping identical to Deals, Leads, Contacts, and Organizations.
- Keep saved views workspace-wide; do not add sharing/private ownership in the same slice.

## Future Tests

For no-schema quick-link polish:

- Source tests for quick-link labels and hrefs.
- Due bucket labels still say open-only.
- Existing due/status/owner/related filters still pass.
- Page size remains handled by shared pagination.

For future Activity saved views:

- `ACTIVITY` enum migration is present.
- Create/list/delete Activity saved views.
- Workspace scoping.
- Record-type scoping: Activity views do not appear on Deals, Leads, Contacts, or Organizations.
- Page number exclusion.
- Status and completed filter behavior.
- Due bucket semantics and open-only behavior.
- Owner filter persistence.
- Related-record filter persistence and stale related values.
- Sort and page-size persistence.
- Invalid payload normalization.

## Recommended Next Implementation Prompt

Northstar CRM - Activity List Quick Links QA Hardening

Run the Activity quick links through a small QA/copy hardening pass. Do not add Activity saved views, schema changes, migrations, reminders, recurrence, notifications, calendar sync, automations, background jobs, integrations, query builder UI, or new modules.

Inspect `app/activities/page.tsx`, `lib/activity-quick-links.ts`, `lib/services/activity-service.ts`, current Activity tests, and this design note. Verify `My open`, `Overdue`, `Due today`, `Upcoming`, and `Completed` use only existing URL params, reset page number, and preserve current due-bucket semantics. Tighten copy/tests only if a real gap is found.
