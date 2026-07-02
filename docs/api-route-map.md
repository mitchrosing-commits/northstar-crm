# Northstar CRM Route Map

This document reflects the implemented MVP routes as of the current foundation.

## Browser Pages

```text
GET /                                  Root entry page
GET /login                             Local email/password login page when AUTH_MODE=local
GET /forgot-password                   Generic password reset request page for existing local-login users
GET /reset-password?token=...          Password reset form for a valid, unconsumed, unexpired reset token
GET /dashboard                         Dashboard shell and summary
GET /reports                           Deal Reporting v1, Goals v1 monthly won-revenue UI, and Forecasting v1 open-deal forecast
GET /pipeline                          Pipeline Kanban board with a Deals CSV export action

GET /deals                             Deal list with filters, sorting, and pagination
GET /deals/new                         Create deal
GET /deals/:dealId                     Deal detail
GET /deals/:dealId/edit                Edit open deal and supported custom field values
GET /deals/:dealId/quotes/:quoteId     Internal quote draft review
GET /deals/:dealId/quotes/:quoteId/print Internal quote draft print view
GET /deals/:dealId/quotes/:quoteId/pdf Authenticated on-demand quote PDF download
GET /q/:token                           Public quote snapshot and sent-quote acceptance form

GET /leads                             Lead list
GET /leads/new                         Create lead
GET /leads/:leadId                     Lead detail and conversion form
GET /leads/:leadId/edit                Edit unconverted lead and supported custom field values

GET /contacts                          Contact list
GET /contacts/new                      Create contact
GET /contacts/:personId                Contact detail
GET /contacts/:personId/edit           Edit contact and supported custom field values

GET /organizations                     Organization list
GET /organizations/new                 Create organization
GET /organizations/:organizationId     Organization detail
GET /organizations/:organizationId/edit Edit organization and supported custom field values

GET /activities                        Global activity list
GET /activities/new                    Create activity attached to an existing CRM record
GET /activities/:activityId/edit       Edit open activity

GET /meeting-intelligence              Meeting artifact intake and recent intake list
GET /meeting-intelligence/:intakeId    Review/edit/apply a persisted meeting intake

GET /products                          Product catalog list and create form
GET /search?q=...                      Global workspace search
GET /custom-fields                     Deal, Contact, Organization, and Lead custom fields admin
GET /settings                          Signed-in user's display-name account settings plus workspace member visibility/management, workspace creation, and email template management
GET /settings/import-export            Workspace CSV export entry point and Deals, Organizations, Contacts, and Leads import preview/import
GET /settings/developer-api            Developer/API overview for workspace REST resources, repo API docs, and planned disabled API-key/webhook controls
GET /workspaces/invitations/:invitationId Workspace invitation acceptance page for signed-in or newly signed-up invitees
```

Notes:

- `logoutAction` clears the local session and active-workspace cookies and revokes the server-side session when using local auth.
- `forgotPasswordAction` creates a hashed, expiring, one-time reset token only for active matching users, but always returns the same generic response. Development/test can display the reset link for manual QA; production never displays reset links and queues password-reset email jobs when `APP_BASE_URL` can build an absolute reset URL. The worker needs either the configured Resend sender or auth email webhook to deliver queued reset emails.
- `resetPasswordAction` accepts a valid reset token once, writes a new `User.passwordHash`, and marks the reset token consumed. Invalid, expired, missing, and consumed tokens fail with the same safe reset-link error.
- `updateAccountDisplayNameAction` is a user-level Settings action for display-name account settings. It updates only the current signed-in user's `User.name`; account email is read-only in this MVP.
- `switchWorkspaceAction` stores an active workspace id in an httpOnly cookie only after verifying the current user is a workspace member.
- `createWorkspaceAction` creates a workspace for the signed-in user, grants `OWNER` membership, and selects it through the same active-workspace cookie.
- `createWorkspaceInvitationAction` creates pending invitations by email for current or future users, and only for workspace owners/admins.
- `revokeWorkspaceInvitationAction` revokes pending invitations for workspace owners/admins.
- `acceptWorkspaceInvitationAction` accepts a matching signed-in user's invitation, creates membership idempotently while the accepted membership still exists, blocks old accepted links after member removal, and selects the invited workspace.
- `removeWorkspaceMemberAction` removes another active workspace member when allowed by role policy: admins can remove normal members, owners can remove admins or normal members, and current owner removal remains blocked.
- `updateWorkspaceMemberRoleAction` lets the workspace owner change another member between Admin and Member. Normal role edits cannot assign Owner.
- `transferWorkspaceOwnershipAction` lets the current workspace owner transfer ownership to another active member; the previous owner becomes Admin.
- Source and integration tests pin the account-settings and workspace role boundaries, including member/admin/owner management denial paths and cross-workspace membership targeting.
- The Developer/API settings page surfaces the current workspace-scoped REST areas and references `docs/openapi.yaml` plus this route map. API keys, webhook subscriptions, and OAuth app controls are intentionally disabled/planned.

## API Base

Tenant-owned API routes are scoped by workspace ID:

```text
/api/v1/workspaces/:workspaceId
```

Access behavior:

- Missing session: `401 UNAUTHENTICATED`.
- Authenticated user without workspace membership: `403 FORBIDDEN`.
- Missing records and cross-workspace record access: non-leaky `404 NOT_FOUND` where appropriate.
- Core REST list endpoints such as `/deals`, `/leads`, `/people`, `/organizations`, and `/activities` return workspace-scoped snapshots and do not currently accept browser list query filters. Use the `/exports/*` CSV endpoints when the current filtered browser list needs to be downloaded with search, filters, and sorting applied.

## Health

```text
GET /api/health
```

Notes:

- Returns generic readiness status only.
- Does not expose environment values, database URLs, user data, or workspace data.

## Workspaces

```text
GET  /api/v1/workspaces
POST /api/v1/workspaces
GET  /api/v1/workspaces/:workspaceId
```

`POST /api/v1/workspaces` requires a trimmed workspace name of 120 characters or fewer. The same validation is used by browser signup and Settings workspace creation.

## Pipelines And Stages

```text
GET    /api/v1/workspaces/:workspaceId/pipelines
POST   /api/v1/workspaces/:workspaceId/pipelines
PATCH  /api/v1/workspaces/:workspaceId/pipelines/:pipelineId
DELETE /api/v1/workspaces/:workspaceId/pipelines/:pipelineId

GET    /api/v1/workspaces/:workspaceId/pipelines/:pipelineId/stages
POST   /api/v1/workspaces/:workspaceId/pipelines/:pipelineId/stages
PATCH  /api/v1/workspaces/:workspaceId/stages/:stageId
DELETE /api/v1/workspaces/:workspaceId/stages/:stageId
```

Pipeline and stage sort orders are validated against the current integer storage range before writes. Stage probabilities are validated to the forecasting-safe `0` to `100` range before writes. Pipeline and stage DELETE routes return `409` while active deals still reference the target pipeline or stage.

## Deals

```text
GET    /api/v1/workspaces/:workspaceId/deals
POST   /api/v1/workspaces/:workspaceId/deals
GET    /api/v1/workspaces/:workspaceId/deals/:dealId
PATCH  /api/v1/workspaces/:workspaceId/deals/:dealId
DELETE /api/v1/workspaces/:workspaceId/deals/:dealId
POST   /api/v1/workspaces/:workspaceId/deals/:dealId/close
POST   /api/v1/workspaces/:workspaceId/deals/:dealId/reopen
POST   /api/v1/workspaces/:workspaceId/deals/:dealId/line-items
GET    /api/v1/workspaces/:workspaceId/deals/:dealId/contracts
POST   /api/v1/workspaces/:workspaceId/deals/:dealId/contracts
POST   /api/v1/workspaces/:workspaceId/deals/:dealId/quotes
PATCH  /api/v1/workspaces/:workspaceId/contract-steps/:contractStepId
POST   /api/v1/workspaces/:workspaceId/quotes/:quoteId/mark-sent
POST   /api/v1/workspaces/:workspaceId/quotes/:quoteId/accept
POST   /api/v1/workspaces/:workspaceId/quotes/:quoteId/decline
PATCH  /api/v1/workspaces/:workspaceId/quotes/:quoteId/adjustments
POST   /api/v1/workspaces/:workspaceId/quotes/:quoteId/public-link
DELETE /api/v1/workspaces/:workspaceId/quotes/:quoteId/public-link
POST   /api/v1/workspaces/:workspaceId/quotes/:quoteId/sync-deal-value
DELETE /api/v1/workspaces/:workspaceId/deal-line-items/:lineItemId
```

Notes:

- Normal `PATCH /deals/:dealId` updates and `DELETE /deals/:dealId` soft-deletes only open deals.
- Deal creation requires the selected stage to belong to the selected pipeline and workspace. Stage movement uses the same deal update path and must stay within the current pipeline.
- Closing uses `/close`, writes `deal.won` or `deal.lost`, sets `wonAt` for won deals, sets `lostAt` for lost deals, and clears the opposite timestamp.
- Reopening uses `/reopen`, only applies to won/lost deals, preserves the current stage, clears `wonAt`/`lostAt`, and writes `deal.reopened`.
- Deal line items snapshot product name, unit price, currency, and quantity. Line item totals do not update deal value. Line item add/remove endpoints are limited to open deals and return `DEAL_CLOSED` for closed deals.
- Contract steps track the local NDA -> MSA -> SOW deal agreement path. Each step stores status, owner, due/sent/signed dates, notes, and an optional external/document reference. The service validates workspace/deal scope, rejects contract-step mutations on closed deals, validates owner membership, and blocks moving MSA/SOW forward before prior required steps are signed or skipped. OpenContracts templates, document generation/storage, redlining, approvals, and e-signature remain deferred integration layers.
- Quote drafts snapshot current deal line items into internal `Quote` and `QuoteItem` records. Quote drafts require at least one line item and one currency. Draft quotes can update one quote-level discount and one quote-level tax adjustment; sent/accepted/declined quotes reject adjustment edits. Quote subtotals, fixed adjustment values, calculated discount/tax amounts, and totals are validated before storage. Lifecycle tracking supports `DRAFT -> SENT -> ACCEPTED` or `DRAFT -> SENT -> DECLINED`, with customer acceptance allowed only from an active public link while the quote is `SENT`. Workspace members can generate one active public quote link for `/q/:token` only while a quote is `SENT`, and can revoke active links afterward; draft, revoked, expired, missing, or malformed tokens return a safe 404. Accepted quotes can be manually synced to the linked open deal value and currency; repeat syncs are no-ops when already matched, and closed deals reject sync through normal deal edit locking. Quote and deal pages expose computed commercial readiness across line items, customer context, next activity, accepted quote sync, and contract/SOW state. Authenticated quote PDFs are generated on demand and not stored. Email delivery, e-signature, line-item discounts, tax rules, and tax jurisdictions are intentionally deferred.

## Products

```text
GET  /api/v1/workspaces/:workspaceId/products
POST /api/v1/workspaces/:workspaceId/products
PATCH /api/v1/workspaces/:workspaceId/products/:productId
POST  /api/v1/workspaces/:workspaceId/products/:productId/deactivate
POST  /api/v1/workspaces/:workspaceId/products/:productId/activate
```

Notes:

- Products are workspace-scoped catalog entries used by deal line items.
- Product edits affect future line items only; existing deal line items keep snapshot values.
- Product CSV export is available through the generic exports endpoint. Product import, price books, inventory, line-item discounts, and product-level tax rules are intentionally deferred.

## Leads

```text
GET   /api/v1/workspaces/:workspaceId/leads
POST  /api/v1/workspaces/:workspaceId/leads
GET   /api/v1/workspaces/:workspaceId/leads/:leadId
PATCH /api/v1/workspaces/:workspaceId/leads/:leadId
POST  /api/v1/workspaces/:workspaceId/leads/:leadId/convert
```

Notes:

- Converted leads are locked from normal edits and reject new activity, note, and manual email-log attachments.
- Conversion creates a deal transactionally and reattaches lead activities/notes to the new deal.

## People / Contacts

```text
GET    /api/v1/workspaces/:workspaceId/people
POST   /api/v1/workspaces/:workspaceId/people
GET    /api/v1/workspaces/:workspaceId/people/:personId
PATCH  /api/v1/workspaces/:workspaceId/people/:personId
DELETE /api/v1/workspaces/:workspaceId/people/:personId
```

## Organizations

```text
GET    /api/v1/workspaces/:workspaceId/organizations
POST   /api/v1/workspaces/:workspaceId/organizations
GET    /api/v1/workspaces/:workspaceId/organizations/:organizationId
PATCH  /api/v1/workspaces/:workspaceId/organizations/:organizationId
DELETE /api/v1/workspaces/:workspaceId/organizations/:organizationId
```

## Activities

```text
GET    /api/v1/workspaces/:workspaceId/activities
POST   /api/v1/workspaces/:workspaceId/activities
PATCH  /api/v1/workspaces/:workspaceId/activities/:activityId
DELETE /api/v1/workspaces/:workspaceId/activities/:activityId
```

Notes:

- Activity creation can attach to an open deal, unconverted lead, person, or organization.
- Activity completion is a `PATCH` with `completedAt`.
- Open activity edit/reschedule is also a `PATCH`.
- Completed activities are locked from normal edits and deletion.
- Deal-attached activities on closed deals and lead-attached activities on converted leads reject update, completion, and deletion.
- Activity attachments cannot be changed through the edit flow.
- The browser Activities page supports overdue, today, upcoming, no-due-date, and recently-completed filters plus workspace-scoped work-queue counts.
- The browser new-activity page can create a follow-up for an existing open deal, contact, organization, or unconverted lead.
- One-click deal activity templates enforce lifecycle fit: open-deal templates reject closed deals, while won/lost-specific templates require their matching closed outcome.
- Deal and Lead list pages support URL-driven follow-up filters for records missing a next activity, overdue, due today, upcoming, and no due date states without adding Activity saved views.

## Meeting Intelligence

```text
GET  /api/v1/workspaces/:workspaceId/meeting-intakes
POST /api/v1/workspaces/:workspaceId/meeting-intakes
GET  /api/v1/workspaces/:workspaceId/meeting-intakes/:intakeId
POST /api/v1/workspaces/:workspaceId/meeting-intakes/:intakeId/apply
```

Notes:

- `POST /meeting-intakes` requires pasted notes, extracted file text, uploaded PDF/DOCX bytes, or artifact filename/MIME type; empty source submissions return `422 VALIDATION_ERROR` before any intake record is created.
- Valid `POST /meeting-intakes` submissions create a persistent review record and run supported local extraction/analysis synchronously.
- Supported sources are pasted text, markdown, text files, text-based PDFs, and DOCX files. Scanned PDFs, images, audio, and video require OCR/transcription/media providers and fail with clear provider-required messages; legacy `.doc` files are unsupported.
- Proposal generation is deterministic by default and does not mutate CRM records. It stores normalized markdown, match results, warnings, proposal evidence, confidence, and proposed notes/activities in review JSON.
- `POST /meeting-intakes/:intakeId/apply` creates only selected user-approved notes, completed meeting activity, and follow-up activities through the existing note/activity services. The apply payload can carry edited content and manually reassigned targets. Submitted targets are validated in the current workspace before writes; missing, deleted, cross-workspace, closed-deal, converted-lead, or intentionally cleared targets are skipped with clear reasons. Existing workspace scoping, closed-deal locks, converted-lead locks, completed-activity behavior, and audit logs apply.
- Reapplying an already-applied intake returns the stored apply result and does not create duplicate notes or activities.

## Notes

```text
GET  /api/v1/workspaces/:workspaceId/notes
POST /api/v1/workspaces/:workspaceId/notes
DELETE /api/v1/workspaces/:workspaceId/notes/:noteId
```

Notes:

- Note creation can attach to an open deal, unconverted lead, person, or organization.
- Closed deals and converted leads reject new note creation and note deletion.
- Notes attached to deleted parent records are excluded from list, timeline, and search reads.
- Note deletion is a soft delete and removes the note from list/detail/timeline/search reads while preserving audit history.

## Email Logs And Templates

```text
GET   /api/v1/workspaces/:workspaceId/email-logs
POST  /api/v1/workspaces/:workspaceId/email-logs

GET   /api/v1/workspaces/:workspaceId/email-templates
POST  /api/v1/workspaces/:workspaceId/email-templates
PATCH /api/v1/workspaces/:workspaceId/email-templates/:templateId
POST  /api/v1/workspaces/:workspaceId/email-templates/:templateId/deactivate
POST  /api/v1/workspaces/:workspaceId/email-templates/:templateId/activate
```

Notes:

- Manual email logs can attach to an open deal, unconverted lead, person, or organization.
- Closed deals and converted leads reject new manual email logs.
- Manual email logs are plain-text CRM history only; they do not send email, sync inboxes, process inbound mail, or create background jobs.
- Email templates are workspace-scoped reusable subject/body snippets for manual email logs. Deactivated templates stay visible in Settings but are not offered in record log forms.

## Custom Fields And Audit Logs

```text
GET  /api/v1/workspaces/:workspaceId/custom-fields
POST /api/v1/workspaces/:workspaceId/custom-fields
PATCH /api/v1/workspaces/:workspaceId/custom-field-values

GET  /api/v1/workspaces/:workspaceId/audit-logs
```

Notes:

- Custom field definition creation is limited to Deal, Contact/Person, Organization, and Lead fields in the MVP.
- Supported editable field types are `TEXT`, `NUMBER`, `DATE`, `BOOLEAN`, and `SELECT`.
- Deal, Contact, Organization, and Lead custom field values are updated through `PATCH /custom-field-values` with `entityType: "DEAL"`, `entityType: "PERSON"`, `entityType: "ORGANIZATION"`, or `entityType: "LEAD"`, the matching record `entityId`, and a field-id-to-value map.
- Closed deals and converted leads display custom fields read-only and reject value updates.
- Soft-deleted records are excluded from custom field reads and writes; value updates against deleted Deals, Contacts, or Organizations return `NOT_FOUND`.
- Unsupported future field types remain read-only until explicit inputs and validation are implemented.
- Browser list pages support one custom field filter at a time for supported custom field types, using `equals`, text-only `contains`, `is_empty`, and `is_not_empty`; Deal Reporting v1 can respect the Deals list query state.

## CSV Exports

```text
GET  /api/v1/workspaces/:workspaceId/exports/deals
GET  /api/v1/workspaces/:workspaceId/exports/contacts
GET  /api/v1/workspaces/:workspaceId/exports/organizations
GET  /api/v1/workspaces/:workspaceId/exports/leads
GET  /api/v1/workspaces/:workspaceId/exports/activities
GET  /api/v1/workspaces/:workspaceId/exports/products
GET  /api/v1/workspaces/:workspaceId/exports/quotes
```

Notes:

- Deal, contact, organization, lead, and activity exports accept the same lightweight list query parameters used by their browser lists, including search where supported, supported filters, sort fields, sort direction, and the existing one-field custom-field filter for CRM records that support it. Deals also accept the supported commercial filters used by the Deals list. Product and quote exports are full workspace-scoped CSV snapshots for their resources.
- The `/settings/import-export` browser surface summarizes each full-workspace export with row counts, custom-field column availability where supported, and header-only copy when the current workspace has no rows for that resource.
- List-page export actions omit pagination parameters so CSV downloads include all matching rows in the current filtered view.
- Exports require the same workspace membership boundary as other workspace API routes.
- Responses are `text/csv` attachments with deterministic, human-readable columns and `private, no-store` cache headers because exports can contain customer CRM data.
- CSV formatting quotes delimiter/newline cells and prefixes spreadsheet formula-looking cell values with an apostrophe so exported user-entered CRM data opens as text instead of executable formulas.
- Deal export commercial count/latest quote columns are derived only from line items and quotes in the requested workspace.
- Core columns are followed by `Custom: Field Name` columns for custom field definitions scoped to the exported record type and workspace. If two custom fields on the same record type share a display name, export headers include the key as `Custom: Field Name (field_key)` so columns remain distinguishable.
- Empty custom field values are exported as empty cells. Simple unsupported/read-only stored values are exported when safe; complex unsupported JSON values are left blank.
- Export rows are scoped to the requested workspace and exclude internal record IDs, custom field IDs, auth/session data, users, memberships, secrets, and infrastructure configuration.
- Notes, saved views, users, memberships, auth/session data, secrets, and infrastructure configuration are not exported. Activity, note, product, quote, saved-view, user, membership, and custom-field import are intentionally deferred.
- CSV import remains limited to Deals, Contacts, Organizations, and Leads.

## CSV Import

Deals, Organizations, Contacts, and Leads imports are currently implemented as browser/server-action workflows on `/settings/import-export`,
not as a public REST endpoint.

Notes:

- Input is pasted CSV text; file upload/storage and background import jobs are not implemented.
- Supported camelCase relationship/date headers also accept human-readable spaced aliases such as `Owner Email`, `Contact Email`, `Organization Name`, `Pipeline Name`, `Stage Name`, and `Expected Close At`.
- Organization preview validates the required `name` column, accepts optional `domain` and `ownerEmail`, reports unsupported columns, validates owners within the current workspace, and detects likely duplicates by organization name within the current workspace.
- Import creation recomputes validation server-side and creates only rows still classified as valid and non-duplicate.
- If a row was valid during preview but cannot be created during import, the result reports the row number with a conservative failure reason instead of silently hiding the partial failure.
- Duplicates and invalid rows are skipped with counts and stable skip reasons. Existing organizations are never overwritten or updated.
- Contacts import validates `name` or `firstName`, supports optional `lastName`, `email`, `phone`, `organizationName`, and `ownerEmail`, detects duplicate emails case-insensitively, and reports missing or ambiguous organization plus missing owner references.
- Contact import creation recomputes validation server-side and creates only rows still classified as valid and non-duplicate. Existing contacts are never overwritten or updated, and organizations are never auto-created from Contacts import.
- Leads import validates `title` or `name`, supports optional `source`, `status`, `contactEmail`, `contactName`, `organizationName`, and `ownerEmail`, detects duplicate titles, defaults blank status to `NEW`, rejects `CONVERTED` status, and reports missing or ambiguous contact/organization plus missing owner references.
- Lead import creation recomputes validation server-side and creates only rows still classified as valid and non-duplicate. Existing leads are never overwritten, updated, merged, or converted, and organizations are never auto-created from Leads import.
- Deals import validates `title` or `name`, required `pipeline` or `pipelineName`, required `stage` or `stageName`, plus optional `status`, `value`, `currency`, `expectedCloseAt`, `contactEmail`, `contactName`, `organizationName`, and `ownerEmail`. Deal values must fit the current integer-cent storage limit. Existing pipeline/stage, owner, contact, and organization references are resolved only inside the current workspace; missing, cross-workspace, or ambiguous references are invalid.
- Deal import creation recomputes validation server-side and creates only rows still classified as valid and non-duplicate. Existing deals are never overwritten, updated, merged, or upserted, and contacts, organizations, and leads are never auto-created from Deals import.
- Import does not deduplicate beyond likely name/email/title/deal-composite matches, import custom fields, or create any record type other than Deals, Organizations, Contacts, and Leads.

## Search

Search is currently implemented as a browser page, not a public REST endpoint:

```text
GET /search?q=...
```

It runs workspace-scoped database queries across deals, leads, contacts, organizations, activities, notes, quotes, and email logs. Quote results are only returned when both the quote and its linked deal resolve inside the current active workspace, and attached activity, note, and email results require every linked CRM record to resolve inside the same active workspace before related labels are rendered.
