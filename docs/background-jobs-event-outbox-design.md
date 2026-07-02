# Background Jobs / Event Outbox Foundation Design

Status: Background Jobs v1 Slices A through F and a small operational queue-status command are implemented. Northstar now has a DB-backed `Job` table, internal job service foundation, explicit handler registry, harmless `internal.noop` handler, queued `auth.password_reset_email` handler, `npm run jobs:status` aggregate status command, `npm run jobs:run-once` single-batch worker command, `npm run jobs:work` continuous worker mode, stale `RUNNING` job recovery with max-attempt dead-lettering in continuous mode, and `npm run jobs:cleanup` terminal retention cleanup. No broader product job handlers, event outbox, automations, reminders, webhooks platform, integrations, or async import processing is implemented yet.

## Objective

Northstar needs a small durable async foundation before adding production email delivery, reminders, automations, webhooks, API-platform callbacks, large imports, integrations, or scheduled workflows. The first foundation should answer one question: how does request/response code persist work safely so another process can retry it without blocking the user or duplicating side effects?

This foundation should unlock:

- password-reset email delivery outside the forgot-password request path.
- later auth and workspace email delivery without adding provider-specific UI.
- later reminder, automation, webhook, import, and integration workers.
- deterministic retry/failure behavior that can be tested with the existing Prisma/PostgreSQL integration lane.

It should not try to solve in v1:

- workflow builders, automation conditions, reminders, recurrence, calendar sync, Gmail/Outlook sync, Slack/Teams, webhooks/API keys, marketplace/platform work, billing, e-signature, payments, or background analytics.
- external queue infrastructure.
- exactly-once side effects. The realistic target is at-least-once processing with idempotent handlers.
- multi-consumer event streaming.
- user-facing job management UI.

## Recommended Model

Use a single `Job` table first. It should be a durable work queue, not an audit log and not a general event stream.

Do not start with both `Job` and `EventOutbox`. The current app has one obvious first async side effect, password-reset webhook delivery, and no need for multiple independent consumers yet. A single `Job` table is the smallest production-grade foundation that supports enqueue, claim, retry, and dead-letter behavior.

Defer a separate immutable `EventOutbox` table until Northstar needs domain-event fanout, such as "deal won" triggering multiple subscribers for webhooks, automations, notifications, analytics, and integrations. At that point, domain services can write `EventOutbox` rows transactionally, and a dispatcher can translate events into one or more `Job` rows.

Audit logs must remain separate. `AuditLog` is workspace CRM history for humans. Jobs are operational work records; they may contain provider payloads and failure details and should not be rendered in record timelines.

## Proposed V1 Schema

Use string job types rather than a Prisma enum so new job handlers do not require a schema migration for every type. Use an enum for status because the lifecycle should be stable.

```prisma
model Workspace {
  id   String @id @default(cuid())
  jobs Job[]
  // existing workspace fields stay unchanged
}

model Job {
  id           String    @id @default(cuid())
  workspaceId  String?
  type         String
  payload      Json
  status       JobStatus @default(PENDING)
  attempts     Int       @default(0)
  maxAttempts  Int       @default(5)
  runAt        DateTime  @default(now())
  lockedAt     DateTime?
  lockedBy     String?
  processedAt  DateTime?
  failedAt     DateTime?
  lastError    String?
  dedupeKey    String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  workspace    Workspace? @relation(fields: [workspaceId], references: [id], onDelete: SetNull)

  @@index([status, runAt])
  @@index([lockedAt])
  @@index([workspaceId, createdAt])
  @@index([type, dedupeKey, status])
}

enum JobStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  DEAD
}
```

Notes:

- `workspaceId` is nullable because auth/account jobs, maintenance jobs, or future global jobs may not belong to a workspace.
- `payload` must be minimal and should store only the data a handler needs. Do not store raw passwords or raw auth tokens. If a reset token is needed for email delivery, store it only as long as necessary and only in this operational table; do not log it or copy it into audit history.
- `dedupeKey` is optional. It should be set only for handlers with a clear idempotency key, such as `password-reset-email:<passwordResetTokenId>` or future webhook delivery ids.
- Slice A intentionally does not include queue names yet. Add a `queue` column only when multiple worker pools are needed.
- Active dedupe is scoped by `type + dedupeKey`, not by workspace. Workspace-specific job callers must include the workspace or target record in the dedupe key when they need tenant-local dedupe. PostgreSQL enforces active dedupe through a partial unique index for `PENDING`, `RUNNING`, and `FAILED`; Prisma keeps a supporting non-unique index because it does not model partial unique indexes directly.
- A future `EventOutbox` table should use immutable `eventType`, `aggregateType`, `aggregateId`, `workspaceId`, `payload`, `occurredAt`, `publishedAt`, and `publishAttempts` fields, but that should not be the first migration.

## Processing Semantics

Recommended status lifecycle:

- `PENDING`: eligible for processing when `runAt <= now`.
- `RUNNING`: claimed by one worker with `lockedAt` and `lockedBy`.
- `SUCCEEDED`: handler completed successfully; set `processedAt`.
- `FAILED`: handler failed but has attempts remaining; set `lastError`, clear lock, and set a future `runAt`.
- `DEAD`: attempts exhausted or handler identifies a permanent poison payload; set `failedAt`.

Claiming should use a database transaction and row-level locking. In PostgreSQL, the worker can select eligible rows with `FOR UPDATE SKIP LOCKED`, ordered by `runAt` and `createdAt`, then update them to `RUNNING` with a worker id. Prisma may need `$queryRaw` for the claim query because `SKIP LOCKED` is the important concurrency primitive.

For a single worker v1:

1. Fetch a small batch, for example 10 jobs, where `status = PENDING` and `runAt <= now`.
2. Claim rows atomically by setting `status = RUNNING`, `lockedAt = now`, and `lockedBy = workerId`.
3. Process each job by dispatching on `type`.
4. On success, mark `SUCCEEDED` with `processedAt`.
5. On retryable failure, increment `attempts`, clear lock, set `status = FAILED` or `PENDING`, and set `runAt` using backoff.
6. On permanent failure or exhausted attempts, set `DEAD` with `failedAt` and `lastError`.

Use `FAILED` as a visible intermediate state only if the next retry is not immediately eligible. A simple implementation can move retryable jobs back to `PENDING` with a future `runAt` while preserving `attempts` and `lastError`; keep `DEAD` for terminal failures.

Backoff should be deterministic and capped:

- attempt 1: 1 minute
- attempt 2: 5 minutes
- attempt 3: 15 minutes
- attempt 4: 1 hour
- attempt 5: dead-letter

Add small jitter only after the first implementation if many jobs are expected to retry together.

Idempotency expectations:

- Every handler must tolerate being called more than once.
- External calls should include a stable idempotency key when the provider supports it.
- Internal state changes should be guarded by job id, target row state, or a durable delivery id before side effects are made.
- Handlers should not rely on in-memory locks.

Poison jobs:

- Invalid payload shape should be marked `DEAD` immediately with a concise `lastError`.
- Provider failures, network failures, and 5xx responses should retry.
- 4xx provider responses should usually be terminal unless the provider contract says otherwise.
- `lastError` should be short, redacted, and never include raw tokens, passwords, webhook bearer tokens, or full provider payloads.

## Initial Job Types

The smallest first real job type should be:

```text
auth.password_reset_email
```

Why:

- Password reset already has a provider-neutral webhook boundary in `lib/email/auth-email.ts`.
- Production currently keeps forgot-password responses generic even when delivery fails.
- Moving delivery to a job preserves that generic response while removing external webhook latency and failure from the request path.
- The handler can remain narrowly auth-only and does not introduce general CRM email sending.

Recommended payload:

```json
{
  "to": "user@example.com",
  "resetUrl": "https://app.example.com/reset-password?token=...",
  "expiresAt": "2026-06-25T12:00:00.000Z"
}
```

Implementation caution: the raw reset token is already exposed to the email provider today through `resetUrl`. If queued delivery is implemented, the token URL would briefly live in the `Job.payload` table. That is acceptable only if the job table is treated as sensitive operational data, never exposed in UI, never copied to audit logs, and cleaned up after a retention window. A more defensive follow-up could store `passwordResetTokenId` plus a short-lived encrypted payload, but encryption-at-rest would be a separate security slice.

Avoid a no-op test job as the first production type unless the team wants to prove worker deployment before touching auth. A no-op is safer but gives less confidence in provider failure/retry behavior.

## Domain Event Strategy

Domain services should not enqueue broad events until there is a real consumer. When consumers exist, likely sources are:

- password reset requested -> enqueue `auth.password_reset_email`.
- invitation created -> later invitation email delivery, still manual/link-only for now.
- activity due -> later reminders, deferred.
- activity completed -> later automation/event feed, deferred.
- deal won/lost -> later automations, webhooks, goals notifications, deferred.
- quote accepted -> later internal notification, webhook, or manual sync prompt, deferred.
- import completed -> later notification or webhook, deferred.
- product/line-item/quote changes -> later integrations, deferred.

For now, domain services may enqueue concrete jobs directly when a concrete async side effect exists. Do not introduce a generic event emitter in every service before consumers are defined.

When Northstar adds automations/webhooks, introduce `EventOutbox` separately:

- Domain mutation transaction writes business row changes, `AuditLog` rows, and `EventOutbox` rows.
- Outbox dispatcher reads unpublished events and creates concrete `Job` rows for subscribers.
- Job handlers deliver side effects with retry and idempotency.

This avoids turning `AuditLog` into an event bus and avoids coupling core CRM services directly to every future integration.

## Worker / Runtime Strategy

Local development:

- Use `npm run jobs:work` for continuous local worker processing.
- Use `npm run jobs:run-once` for deterministic local and CI processing of one batch.
- Local dev can run the worker in a second terminal after `npm run dev`.

Production:

- Run the web process with `npm run start`.
- Run one or more worker processes with `npm run jobs:work`.
- Apply migrations with `npm run prisma:deploy` before starting either process.
- Keep worker env validation aligned with web runtime. `DATABASE_URL` is required; password-reset email jobs need the same `APP_BASE_URL`, `AUTH_EMAIL_WEBHOOK_URL`, optional token, and optional from config as the current direct webhook path.

Use plain PostgreSQL polling first. External queues such as Redis/BullMQ, SQS, Cloud Tasks, or hosted worker platforms should be deferred until:

- job volume or latency requirements exceed simple DB polling.
- queue isolation is needed across noisy tenants.
- delayed/scheduled job scale outgrows indexed `runAt` polling.
- operational hosting provides a clear managed queue that is simpler than DB polling.

Health/readiness:

- `/api/health` should remain web-readiness only and should not fail because a worker is stopped.
- Add a separate worker health/readiness mechanism only if process-manager checks and `jobs:status` are not enough.
- Deployment docs can run the web process and `npm run jobs:work` as separate process types when queued password reset delivery should be processed continuously.

Retention:

- Keep `SUCCEEDED` jobs for a short operational window, for example 7 to 14 days.
- Keep `DEAD` jobs longer, for example 30 to 90 days, until an admin/ops inspection path exists.
- Retention cleanup is implemented as an explicit maintenance command, not as a job type and not as automatic worker behavior.

## Testing Strategy

Unit/source tests:

- job type constants and payload validators.
- enqueue function rejects unknown payload shapes.
- enqueue function sets `workspaceId`, `type`, `payload`, `runAt`, `maxAttempts`, and optional `dedupeKey`; `maxAttempts` is validated against the current integer storage limit before writing.
- password reset flow enqueues without exposing account existence.

Integration tests:

- claim only pending due jobs.
- skip future `runAt` jobs.
- claim with lock metadata and avoid double-claiming from two workers.
- process success marks `SUCCEEDED`.
- retryable failure increments attempts, stores redacted `lastError`, and schedules backoff.
- exhausted retries mark `DEAD`.
- invalid payload marks `DEAD`.
- dedupe key prevents duplicate concrete work.
- password-reset email job calls the existing `sendPasswordResetEmail` boundary.

Idempotency tests:

- processing an already-succeeded job is a no-op.
- retrying password-reset email uses the same reset URL payload and does not create another reset token.
- unknown email forgot-password requests do not enqueue jobs.

Browser tests are not needed until there is a user-facing job UI, worker status UI, or visible async workflow.

## Background Jobs V1 Completion Plan

Background Jobs v1 is runtime-complete for the current password-reset email queue: Northstar can run queued password-reset email delivery without a person repeatedly invoking `jobs:run-once`, can recover safely from interrupted workers, and has an explicit cleanup command for sensitive terminal job payloads. V1 still does not introduce new product workflows beyond `auth.password_reset_email`.

### Continuous Worker Command

Implemented dedicated continuous command:

```bash
npm run jobs:work
```

Implemented shape:

- Reuse `runJobsOnce` internally so the single-batch claim/process/success/retry/dead semantics remain one code path.
- Poll repeatedly until shutdown is requested.
- Process one claimed batch at a time inside a worker process. Do not add in-process concurrent job handling in v1; PostgreSQL `SKIP LOCKED` already allows multiple worker processes later if needed.
- Keep output summary-only. Logs may include aggregate batch counts, worker id, and lifecycle messages, but must not include payloads, reset URLs, tokens, recipient emails, dedupe keys, `lastError`, or secrets.
- One bad job must not kill the loop. Handler failures should continue to flow through the existing retry/dead-letter service and the loop should continue to the next claimed job/batch.

Configuration:

- `JOB_WORKER_ID`: optional worker id. Default should be stable and non-secret, for example `jobs-work-<pid>`.
- `JOBS_BATCH_SIZE`: positive integer, default `10`, capped by the existing claim limit cap.
- `JOBS_POLL_INTERVAL_MS`: positive integer, default `5000`. Invalid, zero, or negative values fall back to the default to avoid tight DB polling.
- `JOBS_STALE_AFTER_MS`: positive integer stale lock timeout for `jobs:work`, default `15 minutes`. Invalid, zero, or negative values fall back to the default to avoid stealing active work.
- `JOBS_IDLE_EXIT_AFTER_MS`: optional test/dev escape hatch only. If set, exit after this much idle time with no claimed jobs. Production should omit it.

Graceful shutdown:

- Listen for `SIGINT` and `SIGTERM`.
- Stop polling immediately after a signal.
- Let the current `runJobsOnce` batch finish, then disconnect Prisma and exit cleanly.
- Do not abandon jobs mid-handler deliberately. If the process is killed hard, stale lock recovery can release those `RUNNING` rows after the configured timeout.
- If command-level setup/database errors occur before the loop starts, exit non-zero with a generic message that does not include secrets.

### Processing Semantics

The continuous worker should preserve existing semantics:

- Claim only `PENDING` jobs where `runAt <= now`.
- Mark claimed jobs `RUNNING`, set `lockedAt`, set `lockedBy`, and increment attempts exactly as `claimJobs` does today.
- Mark success as `SUCCEEDED` with `processedAt`.
- Route handler failures through retry/dead-letter semantics.
- Keep unknown job types safe through the existing "no registered handler" failure path.
- Keep `jobs:run-once` unchanged for deterministic manual/CI processing and operator debugging.

### Stale Lock Recovery

Implemented for continuous worker mode.

Recommended policy:

- A `RUNNING` job is stale when `lockedAt < now - JOBS_STALE_AFTER_MS`.
- Default timeout: `15 minutes`.
- Invalid, zero, or negative timeout config falls back to the 15-minute default.
- Recovery should release retryable stale jobs back to `PENDING`, clear `lockedAt` and `lockedBy`, and set `runAt = now`.
- Recovery should not increment `attempts`; attempts already incremented when the job was claimed. Reprocessing the released job will increment attempts on the next claim.
- Stale jobs that have already reached `maxAttempts` should move to `DEAD` with a generic non-payload error instead of being requeued for an extra attempt.
- Do not recover jobs with `lockedAt` null unless they are `RUNNING`; that state should be treated as invalid and fixed explicitly by the recovery query.

Implemented shape:

- `recoverStaleRunningJobs({ now, staleAfterMs })` updates only jobs with `status = RUNNING` and old `lockedAt`.
- Recovery is integrated into `jobs:work` before each batch.
- `jobs:run-once` does not perform stale recovery, so manual one-batch processing remains deterministic.
- Return aggregate counts only.
- No dedicated `jobs:recover-stale` command exists yet.

Avoid stealing active work:

- Choose a timeout comfortably longer than expected handler duration. `auth.password_reset_email` should normally finish in seconds, so 15 minutes is conservative.
- Keep batch processing sequential in v1. That makes it easier to reason about whether a long-running handler can exceed the stale timeout.
- Do not use stale recovery to interrupt long but healthy jobs; it is only for crashed/terminated workers.

Tests for stale recovery:

- retryable stale `RUNNING` job is released to `PENDING`.
- max-attempt stale `RUNNING` job is marked `DEAD`.
- recent `RUNNING` job is not released.
- released stale job clears lock fields and keeps attempts unchanged.
- continuous worker can recover and then process a stale job.
- recovery output and logs remain aggregate-only.

### Retention And Cleanup

Implemented as an explicit maintenance command.

Retention policy:

- `SUCCEEDED`: delete after 7 days by default.
- `DEAD`: retain for 30 days by default.
- `FAILED`: do not delete while non-terminal. The current retry path requeues retryable failures as `PENDING` with a future `runAt`.
- `RUNNING`: do not delete; stale recovery should handle these.
- `PENDING`: do not delete; they are queued work.

Password reset sensitivity:

- `auth.password_reset_email` payloads include reset URLs with raw reset tokens. Even if those tokens expire, the payload should be treated as sensitive until deleted.
- Short `SUCCEEDED` retention is important because successful password-reset email jobs still contain reset URLs.
- `DEAD` jobs may also contain reset URLs; retain long enough for ops diagnosis, but not indefinitely.

Implemented command:

```bash
npm run jobs:cleanup
```

- Cleanup is an explicit command, not a cleanup job type and not automatic inside `jobs:work`.
- Keep output aggregate-only: counts by deleted status, never payloads or `lastError`.
- Retention windows are configurable with `JOBS_RETAIN_SUCCEEDED_DAYS` and `JOBS_RETAIN_DEAD_DAYS`; missing, invalid, zero, or negative values fall back to documented defaults to avoid accidental immediate deletion.

### Production Readiness

Production should eventually run two process types:

- Web: `npm run start`
- Worker: `npm run jobs:work`

Operational sequence after deploy:

```bash
npm run prisma:deploy
npm run jobs:status
npm run jobs:work
```

If the worker is not running:

- forgot-password responses remain generic.
- password reset email jobs remain `PENDING`.
- `npm run jobs:status` should show due pending jobs and oldest due pending age via `oldestDuePendingRunAt`.
- operators can run `npm run jobs:run-once` manually to process one batch.

Health/readiness:

- Keep `/api/health` web-readiness only for now. It should not fail just because a worker is stopped.
- Do not add queue age to web health in v1.
- If needed later, add a separate worker/process monitor outside the web app, such as supervisor process health plus `jobs:status` checks.

Deployment docs now include:

- `npm run jobs:work`.
- required env vars shared with the web process.
- `JOBS_POLL_INTERVAL_MS`, `JOBS_BATCH_SIZE`, `JOBS_STALE_AFTER_MS`, `JOBS_RETAIN_SUCCEEDED_DAYS`, `JOBS_RETAIN_DEAD_DAYS`, and `JOB_WORKER_ID`.
- a reminder that no automations, reminders, webhooks platform, integrations, or general email sending are enabled by the worker in v1.

### Implemented Stability Tests

Continuous worker tests:

- worker processes queued `internal.noop` and password-reset email jobs and continues polling.
- worker exits cleanly after idle timeout in test mode.
- worker stops polling on simulated shutdown and finishes the current batch.
- worker respects `JOBS_BATCH_SIZE` and `JOBS_POLL_INTERVAL_MS`.
- worker logs/output do not contain payloads, reset URLs, tokens, recipient emails, dedupe keys, `lastError`, or secrets.
- one failed job does not stop later batches.
- `jobs:run-once` behavior remains unchanged.

Password reset tests:

- queued reset delivery succeeds through both one-batch and continuous workers.
- failed webhook delivery retries/dead-letters through existing semantics.
- stale queued reset links remain harmless because token consumption/expiry is checked before provider delivery and again at reset time.

Retention tests:

- cleanup deletes old `SUCCEEDED` jobs and retains recent ones.
- cleanup deletes old `DEAD` jobs according to the longer retention window.
- cleanup skips `PENDING`, `RUNNING`, and retryable jobs.
- cleanup output is aggregate-only.

Future coverage should stay focused on regressions in new job types, new provider boundaries, or new operational surfaces. Do not add broader automations, reminders, webhooks platform, or async import processing under Background Jobs v1 without a separate product scope.

## Implementation Plan

Slice A: Job table and service, no worker loop. Implemented.

- Add `Job` model, `JobStatus` enum, migration, and Prisma client generation.
- Add `lib/services/job-service.ts` with typed `enqueueJob`, `enqueueUniqueJob`, `claimJobs`, `claimNextJob`, `markJobSucceeded`, `markJobFailedForRetry`, `markJobDead`, and `releaseJob`.
- Add payload validation helpers for known job types.
- Add integration tests for enqueue, claim, retry, dead-letter, locking, and dedupe.
- Do not change password reset behavior yet.

Implementation note: the service currently lives at `lib/services/job-service.ts` and is exported through the existing `lib/services/crm.ts` compatibility barrel for tests and future internal callers. Active dedupe is enforced by service-level lookup plus a PostgreSQL partial unique index on `type` and `dedupeKey` for `PENDING`, `RUNNING`, and `FAILED` jobs. Prisma does not model partial unique indexes directly, so the normal Prisma schema keeps a supporting non-unique index while the migration owns the partial unique constraint.

Slice B: Single-run worker command. Implemented.

- Add `scripts/jobs-run-once.ts` with a dispatcher for one batch.
- Add `npm run jobs:run-once`.
- Add an explicit handler registry under `lib/jobs`, currently containing only harmless `internal.noop`.
- Keep handlers idempotent and payload-validation-first.
- Add tests for successful and failing handler outcomes.

Implementation note: `runJobsOnce` claims one due batch, dispatches only explicitly registered handlers, marks success on handler completion, and routes unknown types or handler failures through the existing retry/dead-letter service. The command logs only summary counts and does not log job payloads. Missing or invalid `JOBS_BATCH_SIZE` falls back to the worker default. Handler failures are recorded on jobs and do not make the command fail by themselves; command-level runtime/database failures still exit non-zero.

Slice C: Move password reset email delivery to queued jobs. Implemented.

- `requestPasswordReset` creates the reset token and enqueues `auth.password_reset_email` after token creation when it can build an absolute reset URL from `APP_BASE_URL`.
- Production forgot-password responses remain generic and never expose reset tokens, reset URLs, job ids, or account existence.
- Dev/test reset-link display remains available outside production for manual QA.
- Unknown emails do not enqueue jobs.
- The job handler validates payload shape and calls the existing `sendPasswordResetEmail` provider-neutral webhook boundary.
- Missing password reset email delivery config fails the job through retry/dead-letter semantics without changing the generic request response.
- Password reset email jobs are not deduped in this slice. Re-requesting a reset can enqueue a second email job, while the service consumes the prior active reset token so older queued links cannot reset the password.

Implementation note: the queued password reset email payload contains the reset URL, which includes the raw reset token. Treat the `Job.payload` table as sensitive operational data. The worker and CLI must not print payloads, reset URLs, or tokens, and these jobs must never be surfaced through CRM audit history or user-facing job UI.

Operational queue status command: Implemented.

- Add `npm run jobs:status`.
- Report counts by `JobStatus`.
- Report due pending count, future pending count, running count through status totals, failed/dead counts through status totals, oldest due pending `runAt`, registered-safe job type counts, and a single `unregistered` count for any other job types.
- Keep output aggregate-only: no payloads, arbitrary/unregistered job type names, reset URLs, tokens, recipient emails, dedupe keys, last errors, or secrets.
- Exit cleanly when the queue is empty.

Slice D: Continuous worker mode. Implemented.

- Add `npm run jobs:work`.
- Reuse `runJobsOnce` internally.
- Poll with a default `JOBS_POLL_INTERVAL_MS=5000`.
- Respect `JOB_WORKER_ID` and `JOBS_BATCH_SIZE`.
- Add optional `JOBS_IDLE_EXIT_AFTER_MS` for deterministic tests.
- Gracefully shut down on `SIGINT`/`SIGTERM` by stopping polling and finishing the current batch.
- Keep one-batch-at-a-time sequential processing inside a worker process.
- Keep output aggregate-only and payload-free.

Implementation note: `jobs:work` repeatedly calls the existing single-run worker, processes one due batch at a time, supports `JOB_WORKER_ID`, `JOBS_BATCH_SIZE`, `JOBS_POLL_INTERVAL_MS`, and a test/dev `JOBS_IDLE_EXIT_AFTER_MS`, and handles `SIGINT`/`SIGTERM` by stopping polling after the current batch finishes. Missing or invalid polling and batch config falls back safely, and output remains summary-only.

Slice E: Stale RUNNING job recovery. Implemented.

- Add a service function to release stale `RUNNING` jobs back to `PENDING`.
- Default stale timeout should be 15 minutes.
- Recovery should clear lock fields and set `runAt = now` without incrementing attempts.
- Continuous worker should run recovery periodically before claiming due jobs.
- Manual recovery command remains optional/deferred.

Implementation note: `recoverStaleRunningJobs` handles only `RUNNING` jobs whose `lockedAt` is older than `JOBS_STALE_AFTER_MS`; retryable stale jobs clear `lockedAt`/`lockedBy`, set `runAt = now`, and preserve attempts plus `lastError`, while stale jobs already at `maxAttempts` move to `DEAD` with a generic error. `jobs:work` runs recovery before each batch and prints aggregate recovery/dead-letter counts only when jobs are recovered or dead-lettered. `jobs:run-once` does not run recovery.

Slice F: Terminal job retention cleanup. Implemented.

- Define `SUCCEEDED` retention around 7 days.
- Define `DEAD` retention around 30 days.
- Skip `PENDING` retryable jobs, `RUNNING` jobs, and non-terminal `FAILED` rows.
- Prefer a maintenance command such as `npm run jobs:cleanup` over a cleanup job type for v1.
- Keep cleanup output aggregate-only and payload-free.

Implementation note: `cleanupTerminalJobs` deletes only `SUCCEEDED` jobs older than the succeeded retention window by `processedAt` and `DEAD` jobs older than the dead retention window by `failedAt`, including old terminal rows for deleted workspaces. It leaves `PENDING` retryable jobs, `RUNNING` jobs, and non-terminal `FAILED` rows untouched and returns aggregate counts only. The `jobs:cleanup` command prints only aggregate counts, retention windows, and cutoff timestamps.

Slice G: Continuous-worker documentation and ops readiness. Implemented for Slice D.

- Update deployment docs with continuous-worker commands, env, and operational limitations.
- Add worker-specific status/ops guidance.
- Keep migration guidance: run `npm run prisma:deploy` before web or worker startup.

Rollback safety:

- Adding an unused `Job` table is safe.
- A worker can be stopped without affecting core request flows until request code starts relying on queued jobs.
- When password reset delivery is queued, stopping the worker delays email delivery but forgot-password responses remain generic.
- If queued password reset delivery must be rolled back, direct delivery can be restored while leaving the `Job` table unused.

## Risks And Tradeoffs

- DB polling is simple and testable but not ideal for high-volume integrations. This is acceptable for the first production-grade foundation.
- Queue payloads can contain sensitive operational data. Password-reset email payloads in particular must be treated as secret-bearing until processed/expired.
- At-least-once processing means handlers must be idempotent. Exactly-once side effects are not realistic with external providers.
- A single `Job` table delays a true event-driven architecture. That is intentional until Northstar has multiple consumers that justify a separate `EventOutbox`.
- `SKIP LOCKED` likely requires raw SQL in Prisma. That is a focused use of raw SQL for a concurrency primitive, not a broad departure from Prisma service patterns.
- Running a separate worker is an ops change. It should be introduced only when deployment docs and health expectations are updated.

## Recommended Next Prompt

Recommended next implementation prompt:

Run a final Background Jobs v1 stability/docs gate. Verify `jobs:status`, `jobs:run-once`, `jobs:work`, `jobs:cleanup`, queued password reset delivery, stale recovery, terminal cleanup, docs, and full health checks. Fix only true regressions, stale docs, unsafe output, or missing edge tests. Do not add new job types, automations, reminders, webhooks platform, integrations, UI, provider packages, external queues, or new CRM modules in that slice.
