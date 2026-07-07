# Northstar CRM

Northstar CRM is a multi-tenant sales CRM MVP built with Next.js App Router, TypeScript, Prisma, PostgreSQL, Zod validation, and workspace-scoped REST APIs.

## Current Capabilities

- Workspace-scoped CRM data with auth-ready users, memberships, active workspace switching, workspace creation, email-based workspace invitations, conservative role editing, ownership transfer, and member removal.
- Source and integration tests pin workspace role boundaries and display-name-only account settings behavior.
- Pipeline board with stages and deal cards.
- Deal create/edit, stage movement, won/lost close and reopen flow with persisted close outcome timestamps, deal notes, and deal activities.
- Product Catalog, Deal Line Items, and Quotes with snapshot pricing, quote-level discounts/taxes, status tracking, browser print views, authenticated PDF downloads, public quote links with sent-quote acceptance, and manual accepted-quote deal value sync.
- Lead list/detail/create/edit plus lead-to-deal conversion.
- Contact and organization list/detail/create/edit pages.
- Activity creation from open deals, contacts, organizations, and unconverted leads.
- Activity completion and open-activity edit/reschedule.
- Note creation from deals, contacts, organizations, and unconverted leads.
- Manual email logging from open deal, contact, organization, and unconverted lead detail pages plus workspace email templates for reusable subject/body text.
- Deal, Contact, Organization, Lead, Activity, Product, and Quote CSV export plus conservative, preview-first CSV import for Deals, Contacts, Organizations, and Leads.
- Deal Reporting v1, Forecasting v1, and Goals v1 on Reports, using current deal values, open-deal forecast inputs, and monthly same-currency won-revenue goal progress.
- Password Reset MVP for existing local-login users, with hashed reset tokens, expiry, one-time use, password-reset-only Resend or webhook email delivery when configured, and dev/test-only reset link display.
- Account Settings MVP for signed-in users to view account name/email and update display name only.
- Basic global workspace search across deals, leads, contacts, organizations, activities, notes, quotes, and email logs.
- Deal, Contact, Organization, and Lead custom field admin plus detail value editing for text, number, date, boolean, and select fields.
- Seed data for a demo workspace, users, pipeline, stages, deals, leads, contacts, organizations, activities, notes, custom fields, and audit logs.

## Getting Started

### Quick Local Setup

Use this path for a fresh clone with a local PostgreSQL database:

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
AUTH_MODE=demo npm run dev
```

Then open:

```text
http://localhost:3000/dashboard
```

The default `.env.example` points Prisma at:

```text
postgresql://crm:crm@localhost:5432/crm_mvp?schema=public
```

Create that database/user locally, or replace `DATABASE_URL` with your own PostgreSQL URL before running migrations.

After pulling committed Prisma migrations into an existing local or development database, run:

```bash
npm run prisma:deploy
```

Run this before starting the app or browser smoke tests so the local schema stays aligned with the generated Prisma client.

### Local Auth Mode

Use local auth when you want to test signup, logout, login, and workspace creation:

```bash
AUTH_MODE=local AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters npm run dev
```

Then open:

```text
http://localhost:3000/signup
```

Normal signup-created workspaces stay clean: they receive the user, workspace, default New Business pipeline, and default stages only. They do not receive seeded demo contacts, organizations, deals, activities, notes, quotes, products, contract statuses, or email logs.

Seeded users can also sign in through local auth after `npm run prisma:seed`:

```text
alex@example.test
northstar-demo
```

### Demo Auth Mode

Use demo auth when you want to jump straight into the seeded Northstar Revenue workspace:

```bash
AUTH_MODE=demo npm run dev
```

Then open:

```text
http://localhost:3000/dashboard
```

Demo mode uses `DEV_ACTOR_EMAIL`, defaulting to:

```text
alex@example.test
```

Set `SEED_LOGIN_PASSWORD` before `npm run prisma:seed` if you want a different password for seeded local-login users.

### Founder Preview / Demo

Recommended Sandeep/founder preview setup:

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
AUTH_MODE=demo npm run dev
```

Browser path:

```text
http://localhost:3000/dashboard
```

Local-auth demo login, if using `AUTH_MODE=local` instead of demo mode:

```text
alex@example.test
northstar-demo
```

Suggested walkthrough:

```text
Dashboard -> Pipeline -> Deal detail -> Contract status -> Quote -> Activity/Note/Timeline -> Settings/Email Connections -> Settings/Import / Export
```

Useful routes:

- `/dashboard`
- `/pipeline`
- `/deals`
- `/contacts`
- `/organizations`
- `/activities`
- `/settings`
- `/settings/import-export`

## Hosted Deployment On Railway

Use Railway for the fastest hosted preview today. Northstar runs as a Next.js web service backed by Railway PostgreSQL, with a worker service from the same repo for continuous background jobs such as auth email delivery, Meeting Intelligence media extraction, and Gmail Full Inbox background sync. The included `railway.json` uses:

```text
Build: npm run prisma:generate && npm run build
Pre-deploy: npm run prisma:deploy
Start: npm run railway:start
Health check: /api/health
```

Recommended hosted real-use mode is local auth:

```text
AUTH_MODE=local
```

Only use `AUTH_MODE=demo` for a throwaway demo deployment where every visitor should land as the seeded demo actor.

Railway setup:

1. Create a Railway project from the GitHub repo.
2. Add a Railway PostgreSQL database service.
3. In the web service variables, add `DATABASE_URL` from the Railway Postgres service reference.
4. Leave `RAILWAY_SERVICE_ROLE` unset or set `RAILWAY_SERVICE_ROLE=web`.
5. Set `AUTH_MODE=local`.
6. Set `AUTH_SESSION_SECRET` to a new random 32+ character secret.
7. Set `APP_BASE_URL` to the public Railway app URL after Railway assigns it.
8. Set `EMAIL_TOKEN_ENCRYPTION_KEY` to a new random 32+ byte secret if Gmail, Google Workspace, Microsoft 365, or Outlook OAuth will be enabled.
9. Optional Gmail / Google Workspace OAuth: rotate the Google OAuth client secret before hosted use, set the Google redirect URI to `https://<host>/api/email-connections/google/callback` (for the current Railway production URL: `https://northstar-crm-production-7edf.up.railway.app/api/email-connections/google/callback`), then set the Google OAuth env vars in Railway.
10. Optional Microsoft 365 / Outlook OAuth: create a Microsoft Entra app registration, set its web redirect URI to `https://<host>/api/email-connections/microsoft/callback`, create a client secret, then set the Microsoft OAuth env vars in Railway.
11. Deploy. Railway should install dependencies, run the configured build, run `npm run prisma:deploy`, start the app through `npm run railway:start`, and health-check `/api/health`.
12. Optional demo data: run `npm run prisma:seed` once from a Railway shell or one-off command only for a demo environment. Do not run seed against a real-use database after users create data because the seed script resets the seeded demo workspace.

Required hosted variables:

```text
DATABASE_URL
AUTH_MODE
AUTH_SESSION_SECRET
APP_BASE_URL
```

For the web service, leave `RAILWAY_SERVICE_ROLE` unset or set:

```text
RAILWAY_SERVICE_ROLE=web
```

Optional email OAuth variables:

```text
EMAIL_TOKEN_ENCRYPTION_KEY
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
MICROSOFT_OAUTH_REDIRECT_URI
MICROSOFT_OAUTH_TENANT_ID
```

The documented `GOOGLE_OAUTH_*` names take precedence over the shorter Google aliases `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` when both are present. The documented `MICROSOFT_OAUTH_*` names take precedence over the shorter Microsoft aliases `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_REDIRECT_URI` when both are present. Hosted OAuth redirect URIs must not include embedded username/password credentials. Microsoft uses the `common` tenant unless `MICROSOFT_OAUTH_TENANT_ID` is set to a safe tenant id/domain such as `organizations`, `consumers`, a tenant GUID, or `contoso.onmicrosoft.com`.

Optional password-reset email variables:

```text
AUTH_EMAIL_WEBHOOK_URL
AUTH_EMAIL_WEBHOOK_TOKEN
AUTH_EMAIL_FROM
RESEND_API_KEY
```

Production password reset email delivery also needs `APP_BASE_URL` set to the public HTTPS app URL without embedded username/password credentials, not localhost, loopback, private-network, link-local, or unspecified IP hosts, plus a worker process (`npm run jobs:work`) or scheduled one-off processing (`npm run jobs:run-once`). Webhook delivery URLs must not include embedded username/password credentials; use `AUTH_EMAIL_WEBHOOK_TOKEN` for bearer authentication. The core CRM demo and signup path do not require a worker today unless password reset email delivery must be live.

Do not commit `.env` or real secrets. Production access logs should redact query strings for OAuth callback routes, especially `/api/email-connections/google/callback` and `/api/email-connections/microsoft/callback`; short-lived OAuth authorization codes should not be retained in application, proxy, CDN, or platform logs.

## Development Auth

Requests use the narrow session abstraction in `lib/auth/session.ts`.

For local/demo work, set:

```text
AUTH_MODE=demo
```

Demo mode uses the seeded user by default:

```text
alex@example.test
```

You can override the demo actor with:

```text
DEV_ACTOR_EMAIL=someone@example.test
```

For the built-in local login MVP, set:

```text
AUTH_MODE=local
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
```

Then visit:

```text
http://localhost:3000/login
```

The seed script gives the existing demo users a hashed password. By default:

```text
alex@example.test
northstar-demo
```

Use `SEED_LOGIN_PASSWORD` before seeding to choose a different local/demo password. Local auth also supports signup-created users and clean first workspaces; email change, password change from Settings, account deletion, SSO, OAuth, and 2FA are not included. Expired local sessions are rejected and old expired session rows are pruned during login.

Password reset is available for existing local-login users at:

```text
http://localhost:3000/forgot-password
```

Reset requests always show the same generic response so unknown emails are not revealed. The app stores only hashed reset tokens and accepts each token once before expiry. Development and test environments display a reset link after a successful request for an existing active user and do not require delivery config. Production never displays reset links; it queues password-reset email delivery when `APP_BASE_URL` can build an absolute reset URL from a public HTTPS origin. The worker then needs either direct Resend delivery (`RESEND_API_KEY` plus `AUTH_EMAIL_FROM`) or webhook delivery (`AUTH_EMAIL_WEBHOOK_URL`) to send the queued email. Run `npm run jobs:work` as a separate worker process for continuous processing, or `npm run jobs:run-once` to process one due batch manually. Missing config, queued delivery delay, or delivery failure keeps the same generic response.

Signed-in users can view their account name/email and update only their display name from Settings. Users with more than one workspace membership can switch the active workspace from the app shell. The selection is stored in an httpOnly cookie and revalidated against current memberships; it does not grant access to workspaces where the user is not a member. Signed-in users can also create a workspace from Settings; the creator becomes owner, duplicate display names are allowed, and the new workspace becomes active immediately. Workspace owners/admins can invite teammates by email and remove non-admin members from Settings. Invitees who do not have an account yet can sign up with the invited email, then accept the same invite link. Invitation email delivery is not implemented; accept links are shown for manual sharing. Accepted invitation links are idempotent only while the accepted membership still exists; removed members cannot rejoin with an old accepted link.

For trusted gateway deployments, use:

```text
AUTH_MODE=trusted-header
AUTH_USER_ID_HEADER=x-northstar-user-id
```

That mode requires a safe explicit header name, expects a trusted upstream/session layer to provide the current user id, and returns a missing-session error when the header is absent. Run trusted-header mode only behind a reverse proxy or auth gateway that strips client-supplied auth headers before setting the configured header.

The actor must be a member of the workspace being accessed.

## Database And Seed Data

The Prisma datasource expects PostgreSQL through:

```text
DATABASE_URL
```

Optional deployment/demo values:

```text
APP_BASE_URL
RAILWAY_SERVICE_ROLE
AUTH_MODE
AUTH_USER_ID_HEADER
AUTH_SESSION_SECRET
AUTH_EMAIL_WEBHOOK_URL
AUTH_EMAIL_WEBHOOK_TOKEN
AUTH_EMAIL_FROM
RESEND_API_KEY
EMAIL_TOKEN_ENCRYPTION_KEY
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
MICROSOFT_OAUTH_TENANT_ID
MICROSOFT_OAUTH_REDIRECT_URI
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_REDIRECT_URI
DEV_ACTOR_EMAIL
DEV_WORKSPACE_SLUG
SEED_LOGIN_PASSWORD
TEST_DATABASE_URL
JOB_WORKER_ID
JOBS_BATCH_SIZE
JOBS_POLL_INTERVAL_MS
JOBS_STALE_AFTER_MS
JOBS_RETAIN_SUCCEEDED_DAYS
JOBS_RETAIN_DEAD_DAYS
JOBS_IDLE_EXIT_AFTER_MS
```

Runtime environment validation lives in `lib/env.ts`. A non-sensitive readiness endpoint is available at:

```text
GET /api/health
```

Run seed data with:

```bash
npm run prisma:seed
```

When you pull new committed migrations for an existing local/dev database, apply them with:

```bash
npm run prisma:deploy
```

The seed script resets tenant-owned demo data for the sample workspace before recreating it, so reseeding is intended for local/demo use.

## Background Jobs

Background jobs v1 is used for queued password-reset email delivery when Resend (`RESEND_API_KEY` plus `AUTH_EMAIL_FROM`) or `AUTH_EMAIL_WEBHOOK_URL` is configured, workspace invitation email delivery, Meeting Intelligence provider media extraction, and Gmail Full Inbox background sync. It is not a general automation, reminder, integration, or webhook platform.

Useful commands:

```bash
npm run jobs:status
npm run jobs:run-once
npm run jobs:work
npm run jobs:cleanup
```

- `jobs:status` prints aggregate queue counts only, with registered-safe job types named and any other job types collapsed under `unregistered`.
- `jobs:run-once` processes one due batch and exits.
- `jobs:work` runs a continuous worker, recovers retryable stale running jobs after the configured timeout, dead-letters stale jobs that already reached `maxAttempts`, processes queued Gmail Full Inbox sync jobs, and marks expired or no-longer-current password-reset email jobs complete without sending dead reset links.
- `jobs:cleanup` deletes old terminal succeeded/dead rows according to retention settings.

Production password reset email delivery needs `APP_BASE_URL`, either Resend (`RESEND_API_KEY` plus `AUTH_EMAIL_FROM`) or `AUTH_EMAIL_WEBHOOK_URL`, and either a continuous `npm run jobs:work` process or scheduled `npm run jobs:run-once`.

On Railway, use a second service from the same repo for continuous password reset, workspace invitation, Meeting Intelligence media extraction, and Gmail Full Inbox background sync:

```text
RAILWAY_SERVICE_ROLE=worker
```

The shared `railway.json` start command runs `npm run railway:start`; that dispatcher runs `next start` for the web service and `npm run jobs:work` when `RAILWAY_SERVICE_ROLE=worker`. The worker should share the same `DATABASE_URL`, `APP_BASE_URL`, `AUTH_MODE`, `AUTH_SESSION_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, any `AUTH_EMAIL_*` webhook variables, and email OAuth/token encryption env vars used by the web service. It does not need a public domain. If the worker is not running, forgot-password remains account-enumeration-safe but reset email jobs stay queued and no email is sent, and automatic/background Gmail Full Inbox sync jobs remain queued until `jobs:work` or scheduled `jobs:run-once` processes them. The `/email` Sync Gmail inbox button can process one explicit bounded Gmail sync through the same job record for user-triggered recovery/testing, including stale pending/retryable running Gmail jobs for the selected connection, but it is not a replacement for the continuous worker. After a failed explicit Gmail attempt, the provider card shows retry-scheduled/failure detail with sanitized job and connection references instead of plain queued copy; use `npm run jobs:status` to confirm due pending counts and `npm run jobs:run-once` to process one due batch with the same registered handlers. For Resend testing before a verified custom domain, `AUTH_EMAIL_FROM=Northstar <onboarding@resend.dev>` can be used if accepted by the Resend account.

For a live Gmail connection diagnostic, run `npm run gmail:diagnose -- --workspace northstar-revenue --actor-email alex@example.test --connection-ref <connection-ref> --job-ref <job-ref>` in the same hosted environment as the web service. The actor and connected account can be consumer Gmail or Google Workspace/custom-domain addresses; valid business domains such as `.info`, `.co.uk`, and `.ai` are not gated by TLD allowlists. It can also read `GMAIL_DIAGNOSTIC_WORKSPACE`, `GMAIL_DIAGNOSTIC_ACTOR_EMAIL`, `GMAIL_DIAGNOSTIC_CONNECTION_REF`, and `GMAIL_DIAGNOSTIC_JOB_REF`; it uses the selected connection's encrypted token path and prints only safe categories, non-secret token fingerprints, stored/tokeninfo scope evidence, whether the current OAuth URL requests `gmail.metadata`, refresh/list/full-message get status, profile plus `messages.get` format probes (`minimal`, `metadata`, `full`, `raw`) for up to two listed messages, and optional sync-job/connection matching. If tokeninfo proves stored scopes are stale, it repairs stored scope metadata while preserving a sanitized full-message permission error when Gmail still rejects `messages.get(format=full)`.

## Quality Checks

```bash
npm run prisma:validate
npm run prisma:deploy
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run build
npm run test:browser
git diff --check
```

`npm run prisma` is kept as a short alias for `npm run prisma:validate`; use either command for schema validation.

Run these checks serially when they share the same workspace. In particular, do not run `npm run build` at the same time as `npm run typecheck` or an active dev server; Next can regenerate `.next/types` during build, which may cause false missing-file typecheck failures or unstable browser smoke runs. The `test:browser` script starts `next start` on port `3100`, so run `npm run build` first and rebuild after deleting stale `.next` output if Playwright reports missing production manifests or vendor chunks. The `typecheck` script disables TypeScript incremental cache reads so stale generated route-type references do not mask the current source state.

Manual and lightweight automated browser smoke QA are documented in `docs/browser-smoke-qa.md`.
Deployment and readiness notes are documented in `docs/deployment-readiness.md`.

## Integration Tests

Database-backed integration tests are separate from the fast test suite:

```bash
npm run test:integration
```

They require:

```text
TEST_DATABASE_URL
```

Safeguards:

- `TEST_DATABASE_URL` must be a PostgreSQL URL.
- The database name or schema must include `test`.
- The URL must not contain obvious production, staging, or live environment markers.
- `TEST_DATABASE_URL` must not point at the same database/schema as `DATABASE_URL`.
- The integration setup runs Prisma migrations against `TEST_DATABASE_URL` before tests, then resets app tables in that database once at suite startup while preserving `_prisma_migrations`.
- Each test creates isolated workspaces and cleans them up after the test.

Never point `TEST_DATABASE_URL` at dev, staging, or production data. The suite startup reset exists so failed or interrupted integration runs cannot leave global jobs, reset-email rows, or cleanup-sensitive records that make later all-up runs flaky.

Example:

```text
TEST_DATABASE_URL="postgresql://crm:crm@localhost:5432/crm_mvp_test?schema=public"
```

## Production / Readiness Caveats

- Docker and Docker Compose are not currently included. The supported downloadable path is local Node.js plus PostgreSQL using the commands above.
- Local login and signup are available, but SSO, OAuth providers, 2FA, email change, account deletion, and billing are not implemented.
- Password reset email delivery is queued, Resend-or-webhook, and password-reset-only. `npm run jobs:work` can process queued jobs continuously, recover retryable stale `RUNNING` jobs after a timeout, and dead-letter stale jobs that already reached `maxAttempts`; `npm run jobs:run-once` remains available for one-batch processing, and `npm run jobs:cleanup` removes old terminal job rows. There is no stored auth-email sent table, general SMTP sending, or Outlook background sync.
- Gmail / Google Workspace, Microsoft 365 / Outlook, and IMAP / SMTP cards are visible in Email and Settings. Gmail / Google Workspace and Microsoft 365 / Outlook can connect through OAuth when provider env vars and `EMAIL_TOKEN_ENCRYPTION_KEY` are configured, and OAuth tokens are stored only as encrypted payloads. Gmail / Google Workspace requires the Gmail API plus consent-screen grants for `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`, and `https://www.googleapis.com/auth/gmail.send`; do not add `https://www.googleapis.com/auth/gmail.metadata` for Full Inbox. Google testing-mode apps must include the reconnecting account as a test user, and the hosted redirect URI must match `/api/email-connections/google/callback` exactly. The same Gmail path supports consumer Gmail and Google Workspace custom-domain accounts, including modern and multi-part business domains such as `.info`, `.co.uk`, and `.ai`. Northstar verifies returned or tokeninfo-confirmed Gmail scopes after callback and shows safe missing-scope categories if Google does not grant read/send. Gmail / Google Workspace uses Gmail read/send scopes for job-backed Full Inbox sync, stores inbox messages as email logs with provider labels/snippets/message ids/thread ids, prefers Gmail history cursors after the first recent sync, and falls back to a recent inbox batch when history is missing or expired. The `/email` Sync Gmail inbox action enqueues and immediately claims one bounded Gmail sync job for explicit user-triggered sync/retry, recovers stale retryable jobs for the selected Gmail connection, and surfaces sanitized failure details instead of hiding behind an older queued job. Reconnecting Gmail queues an initial sync for the worker. Gmail sends replies only from an explicit user-submitted reply form. Active Gmail or Microsoft provider connections can be disconnected from `/email`, which removes the encrypted OAuth secret without deleting already-synced email-log snapshots. Microsoft 365 / Outlook remains on manual recent metadata sync for matched known-contact messages. IMAP / SMTP remains planned/disabled for non-Google hosting-provider email.
- Gmail Full Inbox supports multiple current-user Gmail / Google Workspace accounts in one workspace. The login email is suggested but not forced, `/email` can show Unified inbox or one selected account, sync all or one selected account, and replies use the source Gmail connection attached to the selected email log. Synced logs store `emailConnectionId` so duplicate provider message ids across accounts stay separate.
- Production access logs should redact query strings for OAuth callback routes, especially `/api/email-connections/google/callback` and `/api/email-connections/microsoft/callback`; short-lived authorization codes should not be retained in application, proxy, CDN, or platform logs.
- Workspace switching only supports existing memberships plus workspaces the signed-in user creates or accepts by invitation. Invitation email delivery, advanced role policy, workspace deletion, and billing are not implemented.
- Member removal does not delete user accounts or CRM records, and the service blocks removing the last owner/admin.
- Price books, inventory, line-item discounts beyond quote-level adjustments, tax rules/jurisdictions, subscriptions, stored PDF files, Outlook background sync, general SMTP sending beyond explicit Gmail replies, inbound email processing beyond Gmail Full Inbox snapshots, payments, e-signature, document generation, and approvals are not implemented.
- Quote acceptance from a public link does not update the linked deal automatically. Accepted quote sync is explicit, authenticated, and manual; quote PDFs are generated on demand and not stored.
- Deal line item totals do not overwrite deal value or reporting totals.
- Workspace roles are modeled but not used for advanced permissions.
- Fast tests are mostly source-level checks; database-backed integration tests cover a small set of high-risk service workflows.
- Custom fields currently support Deals, Contacts/People, Organizations, and Leads in the UI for text, number, date, boolean, and single-select values.
- Converted leads display custom fields read-only and reject custom field value updates.
- Custom field list filtering is limited to one supported custom field at a time with `equals`, text-only `contains`, `is_empty`, and `is_not_empty` operators. Multiple custom-field filters, number/date comparisons, select filtering, and custom field reporting beyond Deal Reporting's existing Deals-query-state support are not implemented yet.
- Forecasting v1 and Goals v1 are lightweight Reports features only. Forecasting has no history/snapshots/charts, Goals are workspace-level monthly won-revenue only, and neither feature includes owner/team targets, quarterly/activity goals, dashboard widgets, FX conversion, saved reports, or scheduled reports.
- CSV import is limited to Deals, Contacts, Organizations, and Leads using pasted CSV text. Custom field import, Activities/Notes/Products/Quotes import, file upload/storage, and background import jobs are not implemented.
- Calendar sync, automations, webhooks, API keys, and broader product background jobs are not implemented. The current background job runtime is limited to internal worker mechanics plus explicit handlers for auth email, workspace invitations, Meeting Intelligence media extraction, and Gmail Full Inbox sync.
- OpenAPI is an MVP reference document, not a generated contract.
