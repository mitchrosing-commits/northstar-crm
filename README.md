# Northstar CRM

Northstar CRM is a multi-tenant sales CRM MVP built with Next.js App Router, TypeScript, Prisma, PostgreSQL, Zod validation, and workspace-scoped REST APIs.

## Current Capabilities

- Workspace-scoped CRM data with auth-ready users, memberships, active workspace switching, workspace creation, existing-user invitations, conservative role editing, ownership transfer, and member removal.
- Source and integration tests pin workspace role boundaries and display-name-only account settings behavior.
- Pipeline board with stages and deal cards.
- Deal create/edit, stage movement, won/lost close and reopen flow with persisted close outcome timestamps, deal notes, and deal activities.
- Product Catalog, Deal Line Items, and Quotes with snapshot pricing, quote-level discounts/taxes, status tracking, browser print views, authenticated PDF downloads, public quote links with sent-quote acceptance, and manual accepted-quote deal value sync.
- Lead list/detail/create/edit plus lead-to-deal conversion.
- Contact and organization list/detail/create/edit pages.
- Activity creation from deals, contacts, organizations, and leads.
- Activity completion and open-activity edit/reschedule.
- Note creation from deals, contacts, organizations, and unconverted leads.
- Manual email logging from core record detail pages plus workspace email templates for reusable subject/body text.
- Deal, Contact, Organization, Lead, Activity, and Quote CSV export plus conservative, preview-first CSV import for Deals, Contacts, Organizations, and Leads.
- Deal Reporting v1, Forecasting v1, and Goals v1 on Reports, using current deal values, open-deal forecast inputs, and monthly same-currency won-revenue goal progress.
- Password Reset MVP for existing local-login users, with hashed reset tokens, expiry, one-time use, password-reset-only webhook email delivery when configured, and dev/test-only reset link display.
- Account Settings MVP for signed-in users to view account name/email and update display name only.
- Basic global workspace search across deals, leads, contacts, organizations, activities, and notes.
- Deal, Contact, Organization, and Lead custom field admin plus detail value editing for text, number, date, and boolean fields.
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

Use Railway for the fastest hosted preview today. Northstar runs as a single Next.js web service backed by Railway PostgreSQL. The included `railway.json` uses:

```text
Build: npm run prisma:generate && npm run build
Pre-deploy: npm run prisma:deploy
Start: npm run start
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
4. Set `AUTH_MODE=local`.
5. Set `AUTH_SESSION_SECRET` to a new random 32+ character secret.
6. Set `APP_BASE_URL` to the public Railway app URL after Railway assigns it.
7. Set `EMAIL_TOKEN_ENCRYPTION_KEY` to a new random 32+ byte secret if Gmail OAuth will be enabled.
8. Optional Gmail OAuth: rotate the Google OAuth client secret before hosted use, set the Google redirect URI to `https://<host>/api/email-connections/google/callback`, then set the Google OAuth env vars in Railway.
9. Deploy. Railway should install dependencies, run the configured build, run `npm run prisma:deploy`, start the app, and health-check `/api/health`.
10. Optional demo data: run `npm run prisma:seed` once from a Railway shell or one-off command only for a demo environment. Do not run seed against a real-use database after users create data because the seed script resets the seeded demo workspace.

Required hosted variables:

```text
DATABASE_URL
AUTH_MODE
AUTH_SESSION_SECRET
APP_BASE_URL
```

Optional Gmail variables:

```text
EMAIL_TOKEN_ENCRYPTION_KEY
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
```

The shorter Google aliases `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are also accepted.

Optional password-reset email variables:

```text
AUTH_EMAIL_WEBHOOK_URL
AUTH_EMAIL_WEBHOOK_TOKEN
AUTH_EMAIL_FROM
```

Production password reset email delivery also needs a worker process (`npm run jobs:work`) or scheduled one-off processing (`npm run jobs:run-once`). The core CRM demo and signup path do not require a worker today unless password reset email delivery must be live.

Do not commit `.env` or real secrets. Production access logs should redact query strings for OAuth callback routes, especially `/api/email-connections/google/callback`; short-lived OAuth authorization codes should not be retained in application, proxy, CDN, or platform logs.

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

Use `SEED_LOGIN_PASSWORD` before seeding to choose a different local/demo password. Local login is intentionally limited to existing users; signup, email change, password change, account deletion, SSO, OAuth, and 2FA are not included. Expired local sessions are rejected and old expired session rows are pruned during login.

Password reset is available for existing local-login users at:

```text
http://localhost:3000/forgot-password
```

Reset requests always show the same generic response so unknown emails are not revealed. The app stores only hashed reset tokens and accepts each token once before expiry. Development and test environments display a reset link after a successful request for an existing active user and do not require webhook config. Production never displays reset links; it queues password-reset email delivery through the provider-neutral auth email webhook when `APP_BASE_URL` and `AUTH_EMAIL_WEBHOOK_URL` are configured with safe HTTPS URLs. Run `npm run jobs:work` as a separate worker process for continuous processing, or `npm run jobs:run-once` to process one due batch manually. Missing config, queued delivery delay, or delivery failure keeps the same generic response.

Signed-in users can view their account name/email and update only their display name from Settings. Users with more than one workspace membership can switch the active workspace from the app shell. The selection is stored in an httpOnly cookie and revalidated against current memberships; it does not grant access to workspaces where the user is not a member. Signed-in users can also create a workspace from Settings; the creator becomes owner, duplicate display names are allowed, and the new workspace becomes active immediately. Workspace owners/admins can invite existing users and remove non-admin members from Settings, but invitation email delivery is not implemented; accept links are shown for manual sharing. Accepted invitation links are idempotent only while the accepted membership still exists; removed members cannot rejoin with an old accepted link.

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
AUTH_MODE
AUTH_USER_ID_HEADER
AUTH_SESSION_SECRET
AUTH_EMAIL_WEBHOOK_URL
AUTH_EMAIL_WEBHOOK_TOKEN
AUTH_EMAIL_FROM
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

Background jobs v1 is used for queued password-reset email delivery when `AUTH_EMAIL_WEBHOOK_URL` is configured. It is not a general automation, reminder, integration, or webhook platform.

Useful commands:

```bash
npm run jobs:status
npm run jobs:run-once
npm run jobs:work
npm run jobs:cleanup
```

- `jobs:status` prints aggregate queue counts only.
- `jobs:run-once` processes one due batch and exits.
- `jobs:work` runs a continuous worker and recovers stale running jobs after the configured timeout.
- `jobs:cleanup` deletes old terminal succeeded/dead rows according to retention settings.

Production password reset email delivery needs `APP_BASE_URL`, `AUTH_EMAIL_WEBHOOK_URL`, and either a continuous `npm run jobs:work` process or scheduled `npm run jobs:run-once`.

## Quality Checks

```bash
npm run prisma:validate
npm run prisma:deploy
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:browser
npm run build
git diff --check
```

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
- `TEST_DATABASE_URL` must not point at the same database/schema as `DATABASE_URL`.
- The integration setup runs Prisma migrations against `TEST_DATABASE_URL` before tests.
- Each test creates isolated workspaces and cleans them up after the test.

Example:

```text
TEST_DATABASE_URL="postgresql://crm:crm@localhost:5432/crm_mvp_test?schema=public"
```

## Production / Readiness Caveats

- Docker and Docker Compose are not currently included. The supported downloadable path is local Node.js plus PostgreSQL using the commands above.
- Local login and signup are available, but SSO, OAuth providers, 2FA, email change, account deletion, and billing are not implemented.
- Password reset email delivery is queued, webhook-only, and password-reset-only. `npm run jobs:work` can process queued jobs continuously and recover stale `RUNNING` jobs after a timeout, `npm run jobs:run-once` remains available for one-batch processing, and `npm run jobs:cleanup` removes old terminal job rows. There is no stored sent-email table, general SMTP sending, or Gmail/Outlook background sync.
- Gmail / Google Workspace, Microsoft 365 / Outlook, and IMAP / SMTP cards are visible in Settings. Gmail can connect through OAuth when Google env vars and `EMAIL_TOKEN_ENCRYPTION_KEY` are configured, and OAuth tokens are stored only as encrypted payloads. Connected Gmail accounts can run a manual recent metadata sync that imports only matched known-contact messages as conservative email logs. Microsoft 365 / Outlook and IMAP / SMTP remain planned/disabled, and there is no whole-mailbox sync.
- Production access logs should redact query strings for OAuth callback routes, especially `/api/email-connections/google/callback`; short-lived authorization codes should not be retained in application, proxy, CDN, or platform logs.
- Workspace switching only supports existing memberships plus workspaces the signed-in user creates or accepts by invitation. Invitation email delivery, advanced role policy, workspace deletion, and billing are not implemented.
- Member removal does not delete user accounts or CRM records, and the service blocks removing the last owner/admin.
- Price books, inventory, line-item discounts beyond quote-level adjustments, tax rules/jurisdictions, subscriptions, stored PDF files, background Gmail/Outlook sync, general SMTP sending, inbound email processing, payments, e-signature, document generation, and approvals are not implemented.
- Quote acceptance from a public link does not update the linked deal automatically. Accepted quote sync is explicit, authenticated, and manual; quote PDFs are generated on demand and not stored.
- Deal line item totals do not overwrite deal value or reporting totals.
- Workspace roles are modeled but not used for advanced permissions.
- Fast tests are mostly source-level checks; database-backed integration tests cover a small set of high-risk service workflows.
- Custom fields currently support Deals, Contacts/People, Organizations, and Leads in the UI; seeded `SELECT` fields are display-only/read-only for now.
- Converted leads display custom fields read-only and reject custom field value updates.
- Custom field list filtering is limited to one supported custom field at a time with exact-value matching. Richer custom field filter operators and custom field reporting beyond Deal Reporting's existing Deals-query-state support are not implemented yet.
- Forecasting v1 and Goals v1 are lightweight Reports features only. Forecasting has no history/snapshots/charts, Goals are workspace-level monthly won-revenue only, and neither feature includes owner/team targets, quarterly/activity goals, dashboard widgets, FX conversion, saved reports, or scheduled reports.
- CSV import is limited to Deals, Contacts, Organizations, and Leads using pasted CSV text. Custom field import, Activities/Notes/Quotes import, file upload/storage, and background import jobs are not implemented.
- Email/calendar sync, automations, webhooks, API keys, and broader product background jobs are not implemented. The current background job runtime is limited to internal worker mechanics and queued password-reset email delivery.
- OpenAPI is an MVP reference document, not a generated contract.
