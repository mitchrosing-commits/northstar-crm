# Northstar CRM Current Status

## Implemented MVP Capabilities

- Multi-tenant workspace data model with users and memberships.
- Current request/workspace context resolves a real active user, workspace, and membership before workspace-scoped page/API work proceeds.
- A narrow auth session abstraction supports local signed-cookie sessions, a configured trusted user-id header, and seeded demo fallback behind explicit auth modes.
- A minimal local login MVP is available with email/password sign-in for existing users, signed httpOnly session cookies, server-side session lookup, expired-session rejection, login-time expired-session cleanup, and logout/session revocation.
- Password Reset MVP is available for existing local-login users with hashed reset tokens, expiry, one-time consumption, generic request responses, queued password-reset-only Resend or webhook email delivery, and dev/test-only reset link display for manual QA.
- Account Settings MVP is available from Settings for signed-in users to view their account name/email and make display-name updates only.
- The app shell shows the current signed-in user's name or email.
- Workspace role helpers centralize `OWNER`, `ADMIN`, and `MEMBER` labels plus simple owner/admin/member checks.
- Authenticated users with multiple memberships can switch the active workspace from the app shell; the selection is persisted in an httpOnly cookie and validated against current memberships.
- Authenticated users can create a new workspace from Settings, become its owner, and have it selected as the active workspace immediately after creation.
- Workspace Settings shows the current workspace, current user's role, settings-access status, account display-name settings, active member list, conservative role editing and ownership-transfer controls, member-removal controls, a simple workspace creation form, and owner/admin invitation controls.
- Settings includes a Developer/API overview for the workspace-scoped REST surface, OpenAPI and route-map references, CSV export endpoints, and planned disabled API-key/webhook controls.
- Workspace invitations are email-based: owners/admins can create and revoke pending invitations, invitees can sign up or sign in with the invited email, accept the shared link, and the accepted workspace becomes active immediately.
- Owners/admins can remove non-admin workspace members from Settings, while only owners can remove admins. Workspace owners can promote/demote Admin/Member roles and transfer ownership to another active member, with audit logs for role changes, ownership transfer, and member removal.
- Role and account permission boundaries are pinned by source and integration tests covering workspace member management, ownership transfer, cross-workspace membership targeting, and display-name-only account updates.
- Runtime environment validation checks required database configuration and optional deployment/demo values.
- A non-sensitive `/api/health` readiness route validates runtime env and database connectivity.
- Local/dev migration readiness is documented: after pulling committed Prisma migrations, run `npm run prisma:deploy` before starting the app or browser smoke tests.
- Development actor/workspace fallback still uses seeded users and the demo workspace when `AUTH_MODE=demo`; trusted user-id headers are honored only in `AUTH_MODE=trusted-header`.
- Workspace API boundaries consistently return `401` for missing sessions, `403` for non-members, and non-leaky `404` responses for missing or cross-workspace records where appropriate.
- A workspace-scoped CSV export is available for Deals, Contacts/People, Organizations, Leads, Activities, and Quotes from Settings. Deal, Contact, Organization, and Lead exports include custom fields for the exported record type.
- Organizations CSV import is available from Settings using pasted CSV text, with required-name validation, unsupported-column reporting, workspace-scoped duplicate detection, conservative creation of valid non-duplicate organizations, and `organization.imported` audit logs.
- Contacts CSV import is available from Settings using pasted CSV text, with required-name validation, case-insensitive email duplicate detection, unsupported-column reporting, workspace-scoped organization-name reference checks, conservative creation of valid non-duplicate contacts, and `contact.imported` audit logs.
- Leads CSV import is available from Settings using pasted CSV text, with required-title validation, status validation, unsupported-column reporting, workspace-scoped organization-name reference checks, duplicate-title detection, conservative creation of valid non-duplicate leads, and `lead.imported` audit logs.
- Pipeline board grouped by stages.
- Deal create/edit, detail view, stage movement, won/lost close and reopen flow with persisted `wonAt`/`lostAt` outcome timestamps, notes, activities, and audit history.
- Product Catalog is available from `/products` with workspace-scoped product creation, editing, deactivation/reactivation, listing, and active product pricing.
- Deal detail pages can add/remove product line items, preserve product name/price snapshots, and show a separate line item total.
- Deal detail pages can create, review, browser-print, download on-demand PDFs, and internally track Quote statuses from current deal line items; quote items snapshot line item names, descriptions, quantities, prices, currency, and totals.
- Draft quotes support one quote-level discount and one quote-level tax adjustment. Percent values are stored as basis points, fixed values are stored as cents, subtotal remains the item snapshot total, percent tax is calculated after discount, final totals cannot go below zero, and sent/accepted/declined quotes lock adjustment editing.
- Authenticated workspace members can generate and revoke secure public quote links. Public quote pages render quote snapshot details at `/q/:token` without the CRM app shell, internal navigation, audit data, workspace member data, or rendered internal IDs, are marked noindex, and allow customer acceptance only from an active, unexpired link while the quote is `SENT`.
- Accepted quote snapshot totals can be manually synced into the linked deal value and currency from quote detail. Sync writes an audit log and is a no-op when the deal already matches the accepted quote.
- Lead list/detail/create/edit and lead-to-deal conversion.
- Contact list/detail/create/edit with linked deals, activities, and notes.
- Organization list/detail/create/edit with linked people, deals, activities, and notes.
- Activity creation from deals, contacts, organizations, and leads.
- Activity completion plus open-activity edit/reschedule; completed activities are locked from normal edits.
- Global Activity creation page can create a follow-up for an existing open deal, contact, organization, or unconverted lead.
- Manual email logs can be created from Deal, Contact, Organization, and unconverted Lead detail pages. Logged emails are workspace-scoped snapshots, appear in record timelines, and do not send email or run whole-mailbox sync.
- Workspace email templates can be created, edited, deactivated, and reused to prefill manual email logs. Deactivated templates remain manageable in Settings but are not offered in record log forms.
- Email connection status foundation is present for Gmail / Google Workspace, Microsoft 365 / Outlook, and IMAP / SMTP provider readiness in Email and Settings. Gmail / Google Workspace and Microsoft 365 / Outlook can start real OAuth connect flows when provider env and `EMAIL_TOKEN_ENCRYPTION_KEY` are configured. OAuth access and refresh tokens are stored only in encrypted `EmailConnectionSecret` rows. Connected accounts can manually sync a tiny recent metadata batch, matching only known workspace contact emails and creating deduped conservative email logs. IMAP / SMTP remains disabled/planned.
- Activities page shows overdue, due-today, upcoming, and open-total work-queue counts with compact due status badges and no-schema quick links for common work queue filters.
- Activity saved views remain deferred before any `SavedViewRecordType.ACTIVITY` migration.
- Deals list surfaces the next open activity for each deal when one exists.
- Deals list shows pipeline hygiene cues for overdue activity, due-today activity, upcoming/unscheduled next activity, and missing next activity.
- Deal detail pages show a next-step/attention panel, history snapshot, grouped open/completed activities, notes, and a deal timeline.
- Deal detail pages show a lightweight Contract Workflow panel when NDA Status, MSA Status, or SOW Status deal custom fields exist, with read-only status chips and no document generation or e-signature actions.
- Note creation from deals, contacts, organizations, and unconverted leads.
- Deal, Contact, Organization, and Lead detail pages use a shared Recent Notes panel with plain-text note creation, newest-first display, author/date context, and soft-delete actions.
- Basic global workspace search across deals, leads, contacts, organizations, activities, and notes.
- Deal, Contact, Organization, and Lead custom field admin plus detail-page value editing for simple fields.
- Deal, Contact, Organization, and Lead list pages show a compact expandable custom field summary for the current record type.
- Deal, Contact, Organization, and Lead list pages include lightweight one-field custom field filtering for supported custom field types, with `equals`, text-only `contains`, `is_empty`, and `is_not_empty` operators.
- Deal, Contact, Organization, and Lead list pages share a normalized URL-driven list-view state for search, filters, sort direction, and pagination size.
- Deals list state constants are centralized for the Deals page, saved views, and reporting.
- Deals, Leads, Contacts, and Organizations saved views can persist and reapply the current URL-driven list state.
- Deal Reporting v1 shows open pipeline value, open deal count, won/lost counts and values, open pipeline value/count by stage, activity status/type summary, quote status summary, top open deals, and top organizations by same-currency open deal value.
- Deal Reporting v1 includes a small pipeline hygiene summary for open deals with overdue activities, due-today activities, and no next activity.
- Forecasting v1 MVP is available on Reports as a table-first open-deal forecast using existing deal value, currency, expected close date, pipeline/stage, owner, and stage probability when set.
- Goals v1 UI MVP is available on Reports with a simple workspace-level monthly won-revenue target form and table-first progress summary.
- Workspace-scoped REST API routes with Zod validation.
- The Developer/API settings surface documents available workspace REST areas for Deals, Contacts/People, Organizations, Leads, Activities, Notes/timeline inputs, Quotes, Products/line items, Import/Export, and internal job commands.
- Seed data for a coherent demo workspace.
- Audit logging for core workspace CRM mutations, workspace membership changes, invitations, quote lifecycle events, and CSV imports.
- Consistent audit/history display for deals, leads, contacts, organizations, and dashboard recent changes.
- Lightweight read-only unified timeline on deals, leads, contacts, and organizations, combining notes, activities, manual email logs, and audit events.
- Separate database-backed integration test lane for high-risk service workflows.
- Automated browser smoke coverage for Dashboard, core CRM list/detail pages, Reports, Products, Settings, Import/Export, quote detail/print/PDF routes, public quote links, and a narrow viewport subset.
- Background jobs foundation Slices A through F are implemented with a DB-backed `Job` table, internal job service for enqueue/claim/retry/success/dead-letter/release/status/stale-recovery/terminal-cleanup, active `type + dedupeKey` dedupe semantics, an explicit handler registry, a harmless `internal.noop` handler, a queued `auth.password_reset_email` handler, a read-only `npm run jobs:status` command, a single-run `npm run jobs:run-once` command, a continuous `npm run jobs:work` worker mode, and an explicit `npm run jobs:cleanup` terminal retention command. The continuous worker releases stale `RUNNING` jobs back to `PENDING` after a timeout. No product job handlers, automations, reminders, webhooks platform, integrations, or async import processing is implemented yet.

## Known Limitations

- Full account management is not implemented. Account Settings currently supports display-name updates only; email change, avatar upload, password change, account deletion, SSO/OAuth, and 2FA are not implemented.
- The auth/session helper supports local signup/login, local password reset for existing users, trusted-header auth, and demo fallback. SSO, OAuth providers, 2FA, and billing are not implemented.
- Password reset email delivery is password-reset-only, supports direct Resend delivery or the provider-neutral webhook fallback, and is queued through the `Job` table. Production reset requests enqueue `auth.password_reset_email` jobs only when an absolute reset URL can be built from `APP_BASE_URL`; `npm run jobs:work` can process queued reset email jobs continuously, and `npm run jobs:run-once` remains available for manual or scheduled one-batch processing. Repeated reset requests can enqueue multiple email jobs, but each new request consumes prior active reset tokens so stale queued links fail safely. Missing config is reported as a readiness warning, and missing or failed delivery still returns the same generic response and never displays reset links.
- Trusted-header mode must run behind a trusted reverse proxy or auth gateway that strips client-supplied auth headers before setting the configured user-id header.
- Local login mode requires `AUTH_MODE=local`, `AUTH_SESSION_SECRET`, existing users with password hashes, and workspace memberships. It is intentionally not a full account-management product.
- Workspace roles are visible and reusable in code, but advanced permissions, visibility groups, and row-level permissions are not implemented.
- Workspace switching is limited to existing memberships plus workspaces the signed-in user creates or accepts by invitation. Broader member management, ownership transfer beyond a single current owner handing off to another active member, and workspace deletion are not implemented.
- Duplicate workspace display names are allowed; new workspaces receive unique generated slugs for routing/API identity.
- No invitation email delivery is implemented. Invitation links are visible in Settings and must be shared manually.
- Invitations do not send email automatically; invitees without an account can create one with the invited email before accepting, and `OWNER` invitations are blocked.
- Invitation management is intentionally narrow: duplicate pending invitations are rejected, pending invitations can be revoked, accepted invitations are idempotent only while the accepted membership still exists, removed members cannot rejoin from old accepted links, and invitations still cannot grant `OWNER`.
- Member management is intentionally narrow: normal members cannot remove others or edit roles, Admins can manage settings but cannot promote/demote admins, remove admins, or transfer ownership, normal role edits cannot assign `OWNER`, current-owner transfer demotes the previous owner to `ADMIN`, current owner removal remains blocked, and the service blocks changes that would leave the workspace without an owner/admin.
- Custom fields are currently supported for Deals, Contacts/People, Organizations, and Leads in the UI.
- Editable custom field types are `TEXT`, `NUMBER`, `DATE`, and `BOOLEAN`.
- Seed data includes realistic editable custom field definitions and values across Deals, Contacts/People, Organizations, and Leads.
- Unsupported custom field types, including seeded `SELECT` examples, display as read-only with plain-language guidance until richer inputs are implemented.
- Converted leads display custom fields read-only and reject custom field value updates.
- Core list search is limited to simple case-insensitive matching on visible CRM fields; it is not full-text search.
- Custom field list filtering is limited to one supported custom field at a time. The MVP supports `equals`, text-only case-insensitive `contains`, `is_empty`, and `is_not_empty`; number/date comparisons, select/multi-select filtering, multiple filters, richer saved views, reporting, searching, reordering, and permissions are not implemented.
- Saved views are currently available for Deals, Leads, Contacts, and Organizations, workspace-wide, and limited to saving/reapplying/deleting list state. Activities would require an intentional saved-view record-type/schema slice, Products have no comparable filter surface, and sharing, ownership, permissions, and broader cross-record saved views are not implemented.
- Deal Reporting v1 is a simple workspace-scoped pipeline insight page; it can respect Deals list query parameters and includes a lightweight Forecasting v1 section, but it does not create saved reports.
- Product Catalog and Deal Line Items are MVP-only. Product import/export, price books, inventory, line-item discounts, tax rules/jurisdictions, and subscriptions are not implemented.
- Quote lifecycle supports internal tracking plus customer acceptance from an active, unexpired public link while a quote is `SENT`: `DRAFT -> SENT -> ACCEPTED` or `DRAFT -> SENT -> DECLINED`. Browser print views and on-demand PDF downloads are available for authenticated users, and public quote links are available through secure tokens. PDF file storage, e-signature, email sending, payment collection, line-item discounts, tax rules, and tax jurisdictions are not implemented.
- Quote-to-deal value sync is explicit and accepted-quote-only. Deal reports and exports reflect synced quote totals only because the deal value changes after a user runs the manual sync action.
- Line item totals do not overwrite deal value or reporting totals. Deal reports and exports continue to use the existing deal value field.
- Pipeline hygiene is a simple next-activity cue; no health score, goals, forecast history, saved reports, or report builder is implemented.
- Forecasting v1 is open-deal-only and current-state-only. It groups currencies separately with no FX conversion, weights only deals whose current stage has a probability set, and does not use closed-deal timing, lost reasons, forecast history, snapshots, goals, quotas, forecast categories, or direct line-item forecast inputs.
- Deal close outcome timestamps are forward-looking. Existing deals closed before the `wonAt`/`lostAt` fields were introduced can remain null because there is no safe historical close-date backfill source.
- Goals v1 is intentionally narrow. It supports workspace-level monthly won-revenue targets using same-currency `WON` deals with `wonAt` inside the month, excludes legacy won deals with null `wonAt`, and does not use `createdAt`, `updatedAt`, or `expectedCloseAt` as fake close dates. No charts, dashboard widgets, owner/user/team goals, quarterly goals, activity goals, or FX conversion is implemented.
- No charting, forecast history, saved reports, scheduled reports, or report builder is implemented.
- Activities are manual CRM follow-ups only; recurring tasks, notifications, reminders, calendar/email sync, and automation are not implemented.
- Activity saved views are not implemented. Activities would require an intentional saved-view record-type/schema slice, and Products still have no comparable saved-view filter surface.
- CSV export is intentionally limited to Deals, Contacts/People, Organizations, Leads, Activities, and Quotes; notes, saved views, users, memberships, auth/session data, and infrastructure configuration are not exported.
- CSV custom field columns are scoped to the exported record type and workspace. Simple stored values are exported; complex unsupported custom field JSON values are left blank.
- Organizations import creation is conservative: it creates valid non-duplicate organizations after server-side revalidation, skips duplicates and invalid rows, and never overwrites or updates existing organizations.
- Organization import preview supports `name` and optional `domain` columns only. Custom field columns and other export-only columns are reported as unsupported and ignored, while skipped rows receive stable skip reasons.
- Contacts import creation is conservative: it creates valid non-duplicate contacts after server-side revalidation, skips duplicate emails and invalid rows, and never overwrites, updates, or merges existing contacts.
- Contacts import supports `name` or `firstName`, plus optional `lastName`, `email`, `phone`, and `organizationName`. Organization references must already exist in the current workspace and ambiguous organization names are reported as invalid.
- Leads import creation is conservative: it creates valid non-duplicate leads after server-side revalidation, skips duplicate titles and invalid rows, and never updates, overwrites, merges, or converts leads.
- Leads import supports `title` or `name`, plus optional `source`, `status`, and `organizationName`. Blank status imports as `NEW`; `NEW`, `QUALIFIED`, and `DISQUALIFIED` are accepted. `CONVERTED` status and conversion behavior are intentionally excluded. Organization references must already exist in the current workspace and ambiguous organization names are reported as invalid.
- Deals import creation is conservative: it creates valid non-duplicate deals after server-side revalidation, skips duplicates and invalid rows, never updates, overwrites, or upserts existing deals, and writes `deal.imported` audit logs.
- Deals import supports `title` or `name`, required `pipeline` or `pipelineName`, required `stage` or `stageName`, plus optional `status`, `value`, `currency`, `expectedCloseAt`, `contactEmail`, `contactName`, `organizationName`, and `ownerEmail`. Pipeline/stage, owner, contact, and organization references must already exist in the current workspace; cross-workspace or ambiguous references are invalid.
- Deals import can create `WON` or `LOST` rows by status, but it does not infer `wonAt`/`lostAt` or lost reasons. Imported won deals with null `wonAt` are excluded from Goals v1 progress unless later reopened and closed in-app.
- CSV import creation does not support Activities, Notes, saved views, users, memberships, or custom fields. Deal custom field import remains deferred; `Custom: ...` columns are reported as unsupported and ignored.
- Manual email logging is plain-text/metadata only. Gmail/Outlook background sync, general SMTP sending, inbound email processing, Smart Bcc capture, email attachments, HTML rendering, tracking pixels, unsubscribe handling, CRM email automations, and API keys are not implemented.
- Email provider settings show configuration readiness, Gmail / Google Workspace and Microsoft 365 / Outlook OAuth connect paths, and manual recent metadata sync actions only after a provider is connected. Provider OAuth requires env vars plus `EMAIL_TOKEN_ENCRYPTION_KEY`; IMAP / SMTP is still planned/disabled. Gmail and Microsoft sync read recent message metadata/snippets, match known contacts, dedupe by provider message id, and skip unmatched messages, full bodies, attachments, labels, deletes, sends, and whole-mailbox import.
- API keys, webhook subscriptions, OAuth app installs, and external developer portals are not implemented. The Developer/API settings page is an honest preview of the current REST surface and planned platform controls.
- Background jobs runtime is limited to the internal `Job` table/service foundation, safe aggregate queue-status inspection, a single-run worker shell, a continuous worker mode with stale `RUNNING` recovery, aggregate-only terminal cleanup, `internal.noop`, and queued password-reset email delivery. No broader product handlers, event outbox, automation, reminder, webhook platform, integration, or async import runtime is implemented yet.
- Fast tests are mostly source-level checks; integration tests require a guarded `TEST_DATABASE_URL`.
- Deployment/readiness documentation exists, but hosting-provider-specific infrastructure is not implemented.
- Mobile responsiveness has basic support and automated browser smoke coverage for a narrow viewport subset.
- OpenAPI is hand-maintained and should eventually be generated or contract-tested.
- Service code has been split into focused domain modules behind the `lib/services/crm.ts` compatibility barrel.
- Unified timelines are read-only and lightweight; they combine notes, activities, manual email logs, and audit events. Calendar history, attachments, comments, and restore/undelete are intentionally deferred.
- Deal detail history uses existing notes, activities, manual email logs, and audit events only; external email/calendar history and generated summaries are not implemented.
- Account display-name updates and password reset requests are auth/account events outside workspace CRM audit history in this MVP.
- Notes and manual email logs are plain text only; rich text, attachments, mentions, comments, and AI summaries are intentionally deferred.

## Recommended Next Slices

1. Keep expanding automated browser smoke coverage around the highest-risk workflows as the UI grows.
2. Add richer custom field filter operators or saved views only after list workflows make the needed semantics clear.
3. Harden Deals CSV import with real customer sample files once available.
4. Add a generated or contract-tested OpenAPI workflow once the API surface grows.
5. Add richer timeline item types only after email/calendar or attachments are introduced.
