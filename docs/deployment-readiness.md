# Deployment Readiness

This document describes the current low-risk path for running Northstar CRM outside a throwaway local demo. It is intentionally provider-neutral.

## Local Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

For an existing local development database after pulling committed migrations, run `npm run prisma:deploy` before starting the app or smoke tests.

Open `http://localhost:3000/dashboard`.

## Railway Hosted Deployment

Railway is the recommended same-day host for Northstar because the app is a conventional Next.js Node web service with Prisma and PostgreSQL. Add Railway PostgreSQL as the database service, point the web service at that database with `DATABASE_URL`, and let `railway.json` drive the web deployment.

The included `railway.json` is intentionally small:

```text
Build command: npm run prisma:generate && npm run build
Pre-deploy command: npm run prisma:deploy
Start command: npm run railway:start
Health check path: /api/health
```

Hosted real-use environments should use:

```text
AUTH_MODE=local
```

Use `AUTH_MODE=demo` only for a throwaway founder/demo deployment where every visitor should become the seeded demo actor. Do not use demo auth for company usage.

Railway steps:

1. Create a Railway project and connect this repo.
2. Add a Railway PostgreSQL service.
3. Add a web service from the repo if Railway did not create one automatically.
4. In the web service variables, set `DATABASE_URL` from the Railway Postgres service reference.
5. Leave `RAILWAY_SERVICE_ROLE` unset or set `RAILWAY_SERVICE_ROLE=web`.
6. Set `AUTH_MODE=local`.
7. Set `AUTH_SESSION_SECRET` to a newly generated 32+ character random secret.
8. Set `APP_BASE_URL` to the public Railway app URL once Railway assigns the domain.
9. Set `EMAIL_TOKEN_ENCRYPTION_KEY` to a newly generated 32+ byte secret if Gmail, Google Workspace, Microsoft 365, or Outlook OAuth will be enabled.
10. For Gmail / Google Workspace OAuth, rotate the Google OAuth client secret before hosted use, add the authorized redirect URI `https://<host>/api/email-connections/google/callback` in Google Cloud, then set the Google OAuth env vars in Railway.
11. For Microsoft 365 / Outlook OAuth, create or update a Microsoft Entra app registration, add the web redirect URI `https://<host>/api/email-connections/microsoft/callback`, create a client secret, then set the Microsoft OAuth env vars in Railway.
12. Deploy the web service. The pre-deploy command applies committed Prisma migrations before the app starts, and `npm run railway:start` dispatches to `next start`.
13. Optional demo seed: run `npm run prisma:seed` once from a Railway shell or one-off command only for a demo database. Do not seed a real-use database after users have created records; the seed script resets tenant-owned data for the seeded demo workspace.
14. Open `https://<host>/signup` for new local-auth users or `https://<host>/login` for existing seeded/local users.

Production command summary:

```text
Install: npm ci
Build: npm run prisma:generate && npm run build
Migrate: npm run prisma:deploy
Start: npm run railway:start
Optional demo seed: npm run prisma:seed
Optional password-reset worker: RAILWAY_SERVICE_ROLE=worker
```

Railway runs install/build/start automatically from the connected repo and `railway.json`. Run seed only as an intentional one-off.

### Railway Password Reset Email Worker

Password reset requests are created by the web service, but email delivery is processed by the background job worker. Without a worker or scheduled one-off job run, reset email jobs stay queued and no reset email is sent.

To enable hosted password reset email delivery on Railway:

1. Keep the web service running with `AUTH_MODE=local`.
2. Configure the web service with `APP_BASE_URL` and one password reset delivery backend:
   - Resend: `RESEND_API_KEY` and `AUTH_EMAIL_FROM`.
   - Webhook fallback: `AUTH_EMAIL_WEBHOOK_URL`, optional `AUTH_EMAIL_WEBHOOK_TOKEN`, and optional `AUTH_EMAIL_FROM`.
3. Create a second Railway service from the same repo, for example `northstar-worker`.
4. Use the same Railway PostgreSQL `DATABASE_URL` reference as the web service.
5. Give the worker the same runtime secrets needed by the web app, including `AUTH_MODE`, `AUTH_SESSION_SECRET`, `APP_BASE_URL`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and any `AUTH_EMAIL_*` webhook variables being used.
6. Set `RAILWAY_SERVICE_ROLE=worker` on the worker service. The shared `railway.json` start command runs `npm run railway:start`, which dispatches to `npm run jobs:work` for worker services.
7. Leave the web service `RAILWAY_SERVICE_ROLE` unset or set it to `web`; it will dispatch to `next start`.
8. Deploy the web service first so migrations run, then deploy or restart the worker. The same pre-deploy migration command may run on both services and is idempotent.
9. Use a Railway one-off command such as `npm run jobs:status` to confirm only aggregate queue counts are printed.

The worker does not need a public domain. Because the shared Railway config includes `/api/health`, the worker dispatcher exposes a tiny health response while the job worker runs. If a continuous worker service is not available, run `npm run jobs:run-once` on a schedule instead. Treat queued password reset job payloads as sensitive because they contain one-time reset URLs until the job reaches a terminal state and is cleaned up.

## Required Environment

Required:

- `DATABASE_URL`: PostgreSQL connection URL used by Prisma.

Optional:

- `APP_BASE_URL`: canonical app URL used for displaying absolute public quote links and password reset email URLs. If unset or if it includes embedded username/password credentials, the app shows relative `/q/:token` quote links. In production, public quote links also fall back to relative `/q/:token` paths unless `APP_BASE_URL` is a public `https` URL. When password reset email delivery is configured in production, this must be a public `https` URL without embedded username/password credentials, not localhost, loopback, private-network, link-local, or unspecified IP hosts.
- `RAILWAY_SERVICE_ROLE`: optional Railway process selector. Leave unset or set to `web` for the Next.js web service. Set to `worker` for the background job worker service.
- `AUTH_MODE`: `demo` for seeded local/demo fallback, `local` for the built-in email/password session MVP, or `trusted-header` for an upstream/session layer that provides the current user id. Production defaults to `trusted-header` when unset.
- `AUTH_USER_ID_HEADER`: trusted request header containing the current user id. Required when the effective auth mode is `trusted-header`; use a dedicated safe header name such as `x-northstar-user-id`.
- `AUTH_SESSION_SECRET`: signing secret for local session cookies. Required when `AUTH_MODE=local`; use at least 32 random characters.
- `AUTH_EMAIL_WEBHOOK_URL`: optional provider-neutral webhook endpoint for password-reset-only email delivery. If set, `APP_BASE_URL` is required. Production requires `https`. Webhook URLs must not include embedded username/password credentials; use `AUTH_EMAIL_WEBHOOK_TOKEN` for bearer authentication instead.
- `AUTH_EMAIL_WEBHOOK_TOKEN`: optional bearer token sent to the password reset email webhook.
- `AUTH_EMAIL_FROM`: sender/from label used by Resend and optionally included in the password reset email webhook payload. For Resend testing before a verified sending domain, `Northstar <onboarding@resend.dev>` can be used if accepted by the Resend account.
- `RESEND_API_KEY`: optional Resend API key for direct password-reset-only email delivery from the background job worker. If set, `AUTH_EMAIL_FROM` and `APP_BASE_URL` are required. Production requires `APP_BASE_URL` to use a public `https` URL.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`: optional Gmail / Google Workspace OAuth configuration. The documented `GOOGLE_OAUTH_*` names take precedence over the shorter Google aliases `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` when both are present. Gmail Connect becomes available only when these values and `EMAIL_TOKEN_ENCRYPTION_KEY` are configured.
- `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_TENANT_ID`, `MICROSOFT_OAUTH_REDIRECT_URI`: optional Microsoft 365 / Outlook OAuth configuration. The shorter `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_REDIRECT_URI` aliases are also accepted. Microsoft Connect becomes available only when these values and `EMAIL_TOKEN_ENCRYPTION_KEY` are configured. `MICROSOFT_OAUTH_TENANT_ID` is optional and defaults to `common`; when set, use a tenant id/domain such as `organizations`, `consumers`, a tenant GUID, or `contoso.onmicrosoft.com`, not a path-like value.
- `EMAIL_TOKEN_ENCRYPTION_KEY`: secret used to derive AES-256-GCM keys for email OAuth token encryption. It must decode to at least 32 bytes. Raw 32+ character strings work for local setup; production should use a random secret.
- `DEV_ACTOR_EMAIL`: temporary development actor email. Defaults to `alex@example.test`.
- `DEV_WORKSPACE_SLUG`: temporary development workspace slug. Defaults to `northstar-revenue`.
- `SEED_LOGIN_PASSWORD`: optional local/demo seed password for the seeded users. Defaults to `northstar-demo`.
- `TEST_DATABASE_URL`: PostgreSQL URL for integration tests. It must point at a database/schema with `test` in the database name or schema and must not match `DATABASE_URL`.

Do not commit real secrets or production database URLs.

## Environment Validation

Runtime validation lives in `lib/env.ts`. The app validates `DATABASE_URL` before creating the Prisma client and validates optional deployment/auth/demo variables when present. In production, password reset email delivery is reported as disabled unless `APP_BASE_URL` is configured and either `RESEND_API_KEY` plus `AUTH_EMAIL_FROM`, or `AUTH_EMAIL_WEBHOOK_URL`, is configured. Forgot-password responses remain generic either way. Gmail and Microsoft OAuth env groups must be complete if any provider var is set; when OAuth env is configured without `EMAIL_TOKEN_ENCRYPTION_KEY`, Settings keeps provider actions disabled and reports that token encryption is required.

OAuth redirect URIs must use public `https` callback hosts in production and must not include embedded username/password credentials. Local builds and local development can use loopback `http://localhost`, `http://127.0.0.1`, or `http://[::1]` redirect URIs, but hosted Railway, Google Cloud, and Microsoft Entra callback URLs must be configured with the public `https://<host>/api/email-connections/.../callback` routes.

Production access logs should redact query strings for OAuth callback routes, especially `/api/email-connections/google/callback` and `/api/email-connections/microsoft/callback`. OAuth authorization codes are short-lived and exchanged before token storage, but callback query strings should not be retained in application, proxy, CDN, or platform logs.

## Microsoft 365 / Outlook Live Setup

Use Microsoft Graph for both Microsoft 365 and Outlook; do not configure separate fake providers for each brand.

1. In Microsoft Entra, create an app registration for the hosted Northstar environment.
2. Add a Web redirect URI: `https://<host>/api/email-connections/microsoft/callback`.
3. Create a client secret for the hosted app registration.
4. In Railway, set `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_REDIRECT_URI`, and `EMAIL_TOKEN_ENCRYPTION_KEY`. Set `MICROSOFT_OAUTH_TENANT_ID` only if the deployment should be tenant-specific; otherwise the app uses `common`. Tenant values must be a tenant id/domain segment, not an OAuth URL path.
5. Redeploy the Railway web service so the provider card can read the new env.
6. Open `/email`, connect either Microsoft 365 or Outlook, then run `Sync recent Microsoft 365 mail` or `Sync recent Outlook mail`.
7. Verify matched known-contact messages appear on `/email` and the related CRM timelines.

Microsoft sync uses read-only sign-in/profile/mail scopes: `openid`, `email`, `profile`, `offline_access`, `User.Read`, and `Mail.Read`. It imports recent metadata/snippets only, skips unmatched messages, deduplicates by provider message id, and does not send, delete, archive, sync attachments, import full inboxes, or store full message bodies.

## Production Local-Auth Checklist

For the current local-auth/password-reset deployment path:

- Set `NODE_ENV=production`.
- Set `AUTH_MODE=local`.
- Set `DATABASE_URL` to the production PostgreSQL database.
- Set `AUTH_SESSION_SECRET` to at least 32 random characters.
- Set `APP_BASE_URL` to the public `https` app origin.
- Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` for direct Resend delivery from the worker, or set `AUTH_EMAIL_WEBHOOK_URL` to a provider-neutral `https` webhook endpoint for password-reset-only email delivery. Webhook URLs must not include embedded username/password credentials.
- Set `AUTH_EMAIL_WEBHOOK_TOKEN` if the webhook fallback requires bearer auth.
- For Resend sandbox testing without a verified custom domain, `AUTH_EMAIL_FROM=Northstar <onboarding@resend.dev>` can be used if accepted by the Resend account.
- Run `npm run prisma:deploy` after pulling migrations and before serving traffic.
- Run `npm run build` for the production bundle.
- Check `GET /api/health`; a ready deployment returns `{ "status": "ok", "service": "northstar-crm" }` and does not expose env values, database URLs, user data, workspace data, or version metadata.

Password reset email delivery is only for auth reset links, delivered through the internal `Job` table and job worker commands using direct Resend delivery or the auth webhook fallback. There is no general CRM email sending, inbox sync, sent-email storage, or delivery analytics. Production never displays reset links; missing config or delivery failure keeps the same generic forgot-password response to avoid account enumeration.

## Auth Boundary

Northstar includes a narrow local login MVP while preserving the existing auth seam:

- `AUTH_MODE=local` enables `/signup`, `/login`, email/password sign-in for existing users, clean workspace creation for new signups, signed httpOnly cookies, server-side `Session` lookup, expired-session rejection, login-time expired-session cleanup, and logout/session revocation.
- Password reset for local-login users stores only hashed reset tokens, uses expiring one-time links, and returns a generic request response. Development/test can display reset links for manual QA and does not require delivery config. Production does not display reset links; when `APP_BASE_URL` can build an absolute reset URL from a public HTTPS origin, it queues a password-reset-only email job. Running `npm run jobs:work` processes queued jobs continuously, while `npm run jobs:run-once` processes one due batch and exits. The worker needs either Resend (`RESEND_API_KEY` plus `AUTH_EMAIL_FROM`) or webhook delivery (`AUTH_EMAIL_WEBHOOK_URL`) to send queued reset emails. Missing config or delivery failure keeps the same generic response.
- `lib/auth/session.ts` resolves a session identity from a trusted user-id header when available.
- `AUTH_MODE=trusted-header` requires a safe `AUTH_USER_ID_HEADER` and returns a clear missing-session error when no trusted user header is present.
- `AUTH_MODE=demo` preserves the seeded local/demo actor fallback, ignores trusted user-id headers, and reports a validation warning under `NODE_ENV=production`.
- `lib/auth/request-context.ts` still verifies that the resolved user exists and belongs to the requested workspace.

Only use `trusted-header` behind infrastructure that strips untrusted client-supplied auth headers before setting the trusted header. Do not expose the app directly to the public internet with a client-spoofable trusted user header.
Local auth is not a full account-management product. It includes signup/login, but does not include OAuth, SSO, 2FA, account email/password management from Settings, general email delivery, or billing.

API access responses are intentionally generic at the boundary: missing sessions return `401`, non-members return `403`, and cross-workspace record access returns non-leaky `404` responses where resource existence should stay hidden.

Browser users with multiple memberships can select an active workspace. The selection is stored in an httpOnly cookie and is revalidated against the current user's memberships on every browser page context resolution. Invalid or stale selections fall back to a valid membership; API routes continue to require explicit workspace IDs and preserve their existing `401`/`403`/`404` behavior.

Signed-in browser users can create a new workspace from Settings. Workspace names are required, trimmed, and capped at 120 characters. The creator receives an `OWNER` membership, the new workspace is selected through the same verified active-workspace cookie, and duplicate display names are allowed with unique generated slugs.

Workspace owners/admins can create and revoke invitations from Settings. Invitations do not send email; the accept link is shown in the app and must be shared manually. Invitees without accounts can sign up with the invited email before accepting. Invite acceptance creates membership only when the signed-in user's email matches the invitation and then selects the invited workspace. Accepted links are idempotent only while the accepted membership still exists; removed members cannot rejoin through an old accepted link. Owners/admins can also remove non-admin members when doing so does not leave the workspace without an owner/admin.

The readiness endpoint is:

```text
GET /api/health
```

It returns only generic status:

```json
{ "status": "ok", "service": "northstar-crm" }
```

It does not expose environment values, database URLs, user data, workspace data, or version metadata.

## Database Migration Flow

For local development:

```bash
npm run prisma:migrate
```

After pulling committed migrations into an existing local/dev database:

```bash
npm run prisma:deploy
```

For deployment environments:

```bash
npm run prisma:deploy
```

`prisma:deploy` applies committed migrations without creating new migration files.

## Seed And Demo Reset Flow

```bash
npm run prisma:seed
```

The seed script resets tenant-owned demo data for the seeded `northstar-revenue` workspace before recreating it. Treat reseeding as local/demo-only unless a deployment explicitly accepts data reset.

## Health Checks

Run the full local readiness suite before deploying a foundation change:

```bash
npm run prisma:validate
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:integration
```

`npm run prisma` is kept as a short alias for `npm run prisma:validate`; use either command for schema validation.

Run `npm run typecheck` and `npm run build` serially. Next typed routes are checked through generated `.next/types`, and `next build` can regenerate that directory while it runs; running both commands against the same workspace at the same time can produce false missing-file typecheck failures. Run `npm run build` before `npm run test:browser`; the browser smoke script starts `next start` on port `3100` and needs the production `.next` artifacts. The `typecheck` script runs TypeScript with incremental cache disabled so stale generated route-type references do not mask the current source state.

`npm run test:integration` requires a safe `TEST_DATABASE_URL` and applies migrations before running database-backed tests.

## Password Reset Job Worker Commands

The background jobs foundation currently has a read-only status command, a single-run processing command, and a continuous worker command for queued password reset email delivery:

```bash
npm run jobs:status
npm run jobs:run-once
npm run jobs:work
npm run jobs:cleanup
```

Optional environment variables:

- `JOB_WORKER_ID`: worker id stored on claimed jobs. Defaults to a process-based id.
- `JOBS_BATCH_SIZE`: positive integer batch size. Missing or invalid values fall back to the worker function default.
- `JOBS_POLL_INTERVAL_MS`: positive integer polling interval for `jobs:work`. Missing or invalid values default to 5000 ms.
- `JOBS_STALE_AFTER_MS`: positive integer stale lock timeout for `jobs:work`. Missing or invalid values default to 15 minutes.
- `JOBS_RETAIN_SUCCEEDED_DAYS`: positive integer retention window for terminal `SUCCEEDED` jobs cleaned by `jobs:cleanup`. Missing or invalid values default to 7 days.
- `JOBS_RETAIN_DEAD_DAYS`: positive integer retention window for terminal `DEAD` jobs cleaned by `jobs:cleanup`. Missing or invalid values default to 30 days.
- `JOBS_IDLE_EXIT_AFTER_MS`: optional test/dev escape hatch for continuous-worker tests. Production should omit it.

`npm run jobs:status` prints aggregate queue counts only: status totals, due/future pending counts, oldest due pending timestamp, registered-safe job type counts, and a single `unregistered` count for any other job types. It does not print job payloads, arbitrary/unregistered job type names, reset URLs, tokens, recipient emails, or secrets.

`npm run jobs:run-once` claims one due batch, dispatches explicitly registered handlers, prints summary counts only, and exits. Handler failures are recorded on the job through retry/dead-letter semantics and do not make the command fail by themselves. The command exits non-zero only for command-level failures such as invalid runtime/database setup.

`npm run jobs:work` repeatedly calls the same single-run worker logic, recovers stale `RUNNING` jobs, dead-letters stale jobs that already consumed their maximum attempts, processes one batch at a time, handles `SIGINT`/`SIGTERM` by finishing the current batch before exit, and prints summary-only lifecycle, recovery, and batch output. It currently handles the harmless `internal.noop` job and queued `auth.password_reset_email` jobs. Expired or no-longer-current password-reset email jobs are marked complete without sending dead reset links. Without running `jobs:work`, `jobs:run-once`, or equivalent scheduling, password reset email jobs remain queued and no reset email is sent.

Stale recovery is intentionally part of `jobs:work`, not `jobs:run-once`. A job is recovered when it is still `RUNNING` and its `lockedAt` is older than the configured timeout. Recovery moves retryable stale jobs back to `PENDING`, clears `lockedAt`/`lockedBy`/`failedAt`, sets `runAt` to now, preserves attempts and `lastError`, and lets a later claim increment attempts normally. If the stale job has already reached `maxAttempts`, recovery marks it `DEAD` with a generic non-payload error instead of running it again. A force-killed worker can therefore delay a job until the stale timeout expires, then the continuous worker can retry it or terminally dead-letter it.

`npm run jobs:cleanup` deletes old terminal jobs only: `SUCCEEDED` jobs older than `JOBS_RETAIN_SUCCEEDED_DAYS` by `processedAt`, and `DEAD` jobs older than `JOBS_RETAIN_DEAD_DAYS` by `failedAt`. It is not limited to active workspaces, so old terminal rows tied to deleted workspaces can still be pruned. It does not delete `PENDING` retryable jobs, `RUNNING` jobs, or non-terminal `FAILED` rows. Run it periodically through ops scheduling once queued password reset email delivery is enabled, because password-reset job payloads can contain reset URLs with raw tokens until terminal rows are cleaned up. Cleanup output is aggregate-only and does not print payloads, reset URLs, tokens, recipient emails, dedupe keys, `lastError`, or secrets.

Basic operational sequence:

```bash
npm run jobs:status
npm run jobs:work
npm run jobs:status
npm run jobs:cleanup
```

Use the first status check to see whether due or dead jobs exist, run the continuous worker as a separate process, then check status again from another shell or after stopping the worker to confirm aggregate counts changed as expected. Run cleanup periodically to remove old terminal rows. For manual or scheduled processing without a long-running worker, use `npm run jobs:run-once` between status checks.

Production password reset email delivery requires:

- current database migrations, including the `Job` table.
- `APP_BASE_URL` configured to the canonical public HTTPS app URL without embedded username/password credentials, not localhost, loopback, private-network, link-local, or unspecified IP hosts, so reset URLs can be built.
- either `RESEND_API_KEY` plus `AUTH_EMAIL_FROM`, or `AUTH_EMAIL_WEBHOOK_URL` configured to the password-reset-only HTTPS webhook.
- a separate worker process running `npm run jobs:work`, or periodic execution of `npm run jobs:run-once`.

The queued password reset email payload includes the reset URL and must be treated as sensitive operational data. The status, run-once, continuous-worker, and cleanup commands print summary counts only and do not print payloads, reset URLs, tokens, recipient emails, or secrets.

## Known Limitations

- SSO, IMAP OAuth/provider setup, and 2FA are not implemented.
- Password reset email delivery is password-reset-only through queued `auth.password_reset_email` jobs and either direct Resend delivery or the provider-neutral auth email webhook. Gmail / Google Workspace and Microsoft 365 / Outlook OAuth connections can store encrypted tokens when configured and can run manual recent metadata sync for matched known-contact messages, but there is no sent-email storage, delivery analytics, general SMTP sending, IMAP setup, or whole-mailbox/background sync.
- Production access/proxy logs should redact OAuth callback query strings, especially for `/api/email-connections/google/callback` and `/api/email-connections/microsoft/callback`; short-lived authorization codes should not be retained in logs.
- Background jobs foundation currently includes the `Job` table, internal service, explicit handler registry, harmless `internal.noop` handler, queued password reset email handler, read-only status command, single-run batch command, continuous worker command, stale `RUNNING` recovery in continuous mode, and aggregate-only terminal cleanup command. There is no broader product job handler runtime, event outbox, automation runtime, reminder runtime, or webhook platform.
- Invitation email delivery, workspace deletion, and billing are not implemented. Workspace switching is limited to current memberships plus newly created or accepted workspaces, while role editing and ownership transfer remain intentionally narrow.
- Member removal only removes access. It does not delete user accounts or CRM records, and the service blocks removal of the last owner/admin.
- Workspace roles are visible and reusable in code, but advanced permissions, visibility groups, and row-level permissions are not implemented.
- A minimal Railway deployment configuration is included for hosted preview use. Other hosting providers still need their own service, database, migration, worker, and secret-management setup.
- Workspace-scoped CSV export exists for Deals, Contacts/People, Organizations, Leads, Activities, Products, and Quotes. Deal, Contact, Organization, and Lead exports include record-type custom fields. Conservative Deals, Organizations, Contacts, and Leads CSV imports exist for pasted CSV text, but imports for activities/notes/products/quotes, custom field import, file upload/storage, background jobs, email/calendar sync, Slack/Teams integration, automations, API keys, and marketplace features are not implemented.
- Prisma configuration lives in `prisma.config.ts`; seed execution remains wired through `npm run prisma:seed`.
