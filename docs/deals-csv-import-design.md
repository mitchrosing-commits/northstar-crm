# Deals CSV Import Design

This note defines the implemented Deals CSV import MVP. It follows the existing `/settings/import-export` pattern: pasted CSV text, preview first, server-side revalidation on import, partial creation of valid non-duplicate rows, stable skip reasons, and no file upload, storage, background jobs, or public import API.

Deals import is implemented as a browser/server-action workflow on `/settings/import-export`.

## Current Import/Export Baseline

- CSV exports are implemented for Deals, Contacts/People, Organizations, and Leads through `GET /api/v1/workspaces/:workspaceId/exports/:resource`.
- The Deals export currently emits: `title`, `status`, `value`, `currency`, `pipeline`, `stage`, `expectedCloseAt`, `contactName`, `contactEmail`, `organizationName`, `ownerEmail`, `createdAt`, `updatedAt`, then `Custom: Field Name` columns for deal custom fields.
- CSV imports are implemented for Deals, Organizations, Contacts, and Leads as browser/server-action workflows on `/settings/import-export`, not as public REST endpoints.
- Existing imports report unsupported columns, skip invalid or duplicate rows, re-run preview validation server-side before creating, never upsert, and write `*.imported` audit logs for created records.
- Existing imports do not support custom field import, file upload/storage, background jobs, or automatic creation of associated records.

## MVP Columns

Required columns:

- `title`, with `name` accepted as an alias.
- `pipeline`, with `pipelineName` accepted as an alias.
- `stage`, with `stageName` accepted as an alias.

Optional columns:

- `status`
- `value`
- `currency`
- `expectedCloseAt`
- `contactEmail`
- `contactName`
- `organizationName`
- `ownerEmail`

Unsupported columns:

- `id`, `createdAt`, `updatedAt`, `source`, `leadId`, `lostReason`, `closedAt`, line-item columns, quote columns, and all `Custom: ...` columns are reported as unsupported and ignored.
- Unknown columns follow the current import behavior: they appear in `unsupportedColumns`, add an "Unsupported columns are ignored and not imported." warning to rows, and do not block otherwise valid rows.

## Association Rules

Pipeline and stage:

- Deals must import into an existing active pipeline and active stage in the current workspace.
- Resolve `pipeline` by normalized pipeline name within the current workspace.
- Resolve `stage` by normalized stage name under the resolved pipeline.
- Missing, not found, deleted, cross-workspace, or ambiguous pipeline/stage references make the row invalid.
- No default pipeline or stage should be inferred in the MVP. This keeps imports explicit and avoids silently landing deals in the wrong board.

Owner:

- Resolve `ownerEmail` case-insensitively against active users who are members of the current workspace.
- Missing `ownerEmail` imports with `ownerId: null`, matching current Organizations/Contacts/Leads import behavior that does not auto-assign owners.
- Unknown, deleted, or non-member owner emails make the row invalid.

Contact:

- `contactEmail` is the primary match key. It must resolve to exactly one active contact in the current workspace.
- If `contactEmail` is blank and `contactName` is present, match normalized display name from `firstName + lastName`; exactly one match is required.
- If both contact fields are blank, import with `personId: null`.
- Missing, deleted, cross-workspace, or ambiguous contact references make the row invalid.
- Deals import must not create contacts.

Organization:

- Resolve `organizationName` by normalized organization name within the current workspace.
- If blank, import with `organizationId: null`.
- Missing, deleted, cross-workspace, or ambiguous organization references make the row invalid.
- Deals import must not create organizations.

Lead/source handling:

- Deals import does not create, convert, or link Leads in the MVP.
- `source` and `leadId` columns are unsupported and ignored with the standard unsupported-column warning.

## Deal Field Rules

Title:

- Trim whitespace.
- Empty title is invalid.
- Use the same practical length expectations as the existing deal create form and service. Do not introduce schema changes.

Value and currency:

- `value` is optional and represents major currency units, matching Deals export output such as `1200.00`.
- Blank `value` imports as `valueCents: null`.
- Non-blank `value` must be a non-negative decimal with at most two fractional digits and must convert safely to integer cents.
- `currency` is optional, defaults to `USD` when blank, and must be a 3-letter uppercase ISO-style code after trimming and uppercasing.

Status:

- Blank `status` imports as `OPEN`.
- Accepted statuses are `OPEN`, `WON`, and `LOST`, case-insensitive.
- Imported `WON` or `LOST` rows create a deal in that status but do not run the interactive close-deal action, do not infer actual `wonAt`/`lostAt` timestamps, and do not store lost reasons.
- Because Goals v1 progress uses `wonAt`, imported `WON` deals with null `wonAt` are excluded from monthly won-revenue goals unless they are later reopened and closed in-app.

Expected close date:

- `expectedCloseAt` is optional.
- Accept ISO datetimes from the current CSV export and simple `YYYY-MM-DD` dates.
- Blank imports as `null`.
- Invalid dates make the row invalid.

Close/lost fields:

- `closedAt`, `closeDate`, `wonAt`, `lostAt`, and `lostReason` input columns are not supported in the import MVP. Runtime close/reopen flows set `wonAt`/`lostAt`, but CSV import does not backfill or infer actual close outcome timestamps.

## Custom Field Rules

- Deal custom field import is intentionally out of scope for this MVP.
- `Custom: ...` columns should be reported as unsupported and ignored, matching existing Organization/Contact/Lead import behavior.
- Future support should map `Custom: Field Name` columns to active `CustomFieldDefinition` rows for `entityType: DEAL` in the current workspace, then validate field types before creation. That should be a separate slice.

## Deduping And Updates

- MVP is create-only. It must not update, merge, overwrite, upsert, or delete existing deals.
- `id` columns are ignored and cannot target existing deals.
- Duplicate detection should be conservative and rerun-safe:
  - Existing duplicate key: normalized title + resolved pipelineId + resolved stageId + resolved personId/null + resolved organizationId/null within the current workspace.
  - CSV duplicate key: the same key among valid rows in the uploaded CSV.
- Duplicate rows should use `status: "duplicate"` with skip reasons, not `status: "invalid"`.
- Same-title deals in different pipelines, stages, contacts, or organizations are allowed.

## Validation And Reporting

- Preview should return `totalRows`, `validRows`, `duplicateRows`, `invalidRows`, `unsupportedColumns`, `parseErrors`, and row-level `errors`, `warnings`, and `skipReasons`, matching existing import previews.
- Import should recompute preview server-side and create only rows still classified as valid and non-duplicate.
- Import is partial-success: invalid and duplicate rows are skipped; successful rows are created; per-row create failures increment `errorCount`.
- Empty CSV text, parse errors, missing required headers, and malformed quoted fields should fail safely in preview without creating records.
- Current import services do not define a row limit. Deals import should not add a deal-only row limit; if row caps are needed, add a shared import utility in a separate hardening pass.

## Audit And Timeline

- Each created deal should write a workspace-scoped `deal.imported` audit log with `entityType: "Deal"`, `entityId` set to the new deal id, and metadata including `importSource: "csv"`, `recordType: "deal"`, `displayName`, `title`, `pipelineId`, `stageId`, and any linked `personId`/`organizationId`.
- The deal record timeline should show the import event through existing audit-log timeline handling.
- Deals import should not create notes, activities, email logs, quote events, or lead-conversion history.

## UX Placement

- Deals import is available on the existing `/settings/import-export` page alongside Organizations, Contacts, and Leads.
- It uses the same pasted-CSV textarea, Preview button, Import valid rows button, result summary, ignored-columns copy, and preview table patterns.
- Helper copy says required and optional columns, states associations must already exist in the current workspace, clarifies that contacts, organizations, and leads are not auto-created, calls out deferred deal custom field import, and notes that imported `WON`/`LOST` status does not preserve actual close timestamps or lost reasons and does not count toward Goals v1 progress without `wonAt`.
- No file upload, import history, async job queue, API endpoint, or bulk-edit UI should be added in this MVP.

## Implemented Test Coverage And Future Hardening

Source/API tests:

- Export/import docs and `/settings/import-export` wiring include Deals import.
- Deals import service is exported from `lib/services/crm.ts`.
- The service uses `ensureWorkspaceAccess`, workspace-scoped lookups, `row.status !== "valid"` skipping, `prisma.deal.create`, `writeAuditLog`, and no `upsert`.
- Unsupported `Custom: ...`, `createdAt`, and `updatedAt` columns are reported and ignored.

Integration tests:

- Preview rejects missing `title`, `pipeline`, or `stage` headers.
- Preview resolves pipeline and stage only within the actor workspace and rejects missing, deleted, cross-workspace, or ambiguous references.
- Preview validates value, currency, status, and expected close date.
- Preview resolves owner by workspace-member email and rejects non-members.
- Preview resolves contact by email or name and organization by name, with missing and ambiguous references invalid.
- Import creates only valid rows, skips invalid and duplicate rows, and is safe to rerun.
- Existing deals are not updated when duplicate rows are imported.
- Created deals have the expected `valueCents`, `currency`, `status`, associations, and `ownerId`.
- Created deals write `deal.imported` audit logs and appear in the deal timeline through audit history.
- Cross-workspace imports are denied through existing workspace access guards.

Browser smoke:

- Existing smoke should keep `/settings/import-export` coverage narrow, with only stable assertions that the Deals CSV textarea/form is present. Do not add a heavy browser import workflow.

## Follow-Up Prompt

Harden Deals CSV import after real sample files are available. Keep the current create-only/server-action architecture, add only focused validation improvements or copy tweaks, and do not add schema changes, public import APIs, background jobs, custom field import, file upload, or update/upsert behavior.
