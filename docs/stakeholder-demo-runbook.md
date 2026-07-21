# Stakeholder Demo Runbook

This runbook is the polished end-to-end path for showing Northstar CRM without bypassing real application behavior. Use seeded or newly created records in the `northstar-revenue` workspace, and keep every AI-assisted mutation review-first.

## Setup

1. Start from a clean database intended for demo use, not production customer data.
2. Apply migrations and seed the demo workspace:

```bash
npm run prisma:deploy
npm run prisma:seed
```

3. Run the app with local auth:

```bash
AUTH_MODE=local AUTH_SESSION_SECRET=demo-session-secret-32-characters-min npm run dev
```

4. Sign in as `alex@example.test` with `SEED_LOGIN_PASSWORD` or the default `northstar-demo`.
5. Keep a worker available for queued flows when demonstrating auth email, Meeting Intelligence provider extraction, or Gmail sync:

```bash
npm run jobs:status
npm run jobs:run-once
```

For a hosted Railway demo, deploy the web service first so `npm run prisma:deploy` runs, then start or restart the worker service with `RAILWAY_SERVICE_ROLE=worker`.

## Demo Sequence

1. **New lead enters the CRM**: open `/leads`, create a lead with a named contact, organization, source, owner, and near-term follow-up context.
2. **Lead is enriched**: open the lead detail page and add a concise note or email context that names the business problem and stakeholder.
3. **Lead converts safely**: use the lead conversion panel, confirm the created deal, and show the converted lead lock state.
4. **Meeting transcript is analyzed**: open `/meeting-intelligence`, paste a short transcript with a meeting date, attendees, a decision, a risk, an explicit action with due date, and one ambiguous or unmatched mention.
5. **Meeting Intelligence proposes updates**: review transcript segments, structured summary sections, association confidence, notes, follow-ups, Relationship Memory suggestions, and CRM Change Proposals. Correct one association inline before apply.
6. **Apply selected meeting output**: apply only reviewed notes, activities, Relationship Memory facts, and meeting associations. Contact and organization field changes must remain CRM Change Proposals until separately reviewed.
7. **Assistant summarizes next actions**: open `/assistant`, ask for the converted deal or highest-risk open-deal summary, then show review-first drafts or CRM proposal handoff without autonomous mutation.
8. **Relevant email is reviewed**: open `/email`, use a stored seeded email or a connected Gmail inbox, link or inspect the CRM association, review sync health, and generate an editable assisted reply if `OPENAI_API_KEY` is configured.
9. **Quote is created from the deal**: add or verify deal line items, open `/quotes`, create a quote draft from the deal, edit line items, and mark the quote sent.
10. **Public quote is accepted**: generate a public link, open `/q/:token`, accept the sent quote from the customer-facing route, and return to the internal quote.
11. **Accepted quote updates the deal safely**: show automatic deal-value sync when the deal is unchanged, or the conflict review panel when the deal value changed after sending.
12. **Follow-up work is visible and completable**: show the quote follow-up or Meeting Intelligence activity on the deal timeline, complete one open activity, and return to the deal.
13. **Dashboard and reporting reflect the state**: open `/dashboard` and `/reports` to show updated pipeline, quote, activity, and forecast context.

## Production Prerequisites

- `DATABASE_URL` points at the intended PostgreSQL database.
- `AUTH_MODE=local`, `AUTH_SESSION_SECRET`, and public `APP_BASE_URL` are configured.
- Railway build runs `npm run prisma:generate && npm run build`.
- Railway pre-deploy runs `npm run prisma:deploy`.
- The worker runs `npm run railway:start` with `RAILWAY_SERVICE_ROLE=worker`, or `npm run jobs:run-once` is scheduled.
- Gmail demo requires Google OAuth env vars plus `EMAIL_TOKEN_ENCRYPTION_KEY`; the worker shares the same values.
- Meeting Intelligence provider-backed OCR/transcription requires provider URL/token, compatible private file storage, and the worker.
- OpenAI-backed Assistant, email reply, or semantic Relationship Memory demos require `OPENAI_API_KEY`.

## Safety Notes

- Do not seed a real-use production database after users create records.
- Do not use demo auth for company usage.
- Do not present AI inference as confirmed fact; use evidence and review states.
- Do not apply CRM Change Proposals during the demo unless the reviewer explicitly approves them.
- Do not send live Gmail replies unless the customer-facing text has been reviewed in the editable form.
- If a target is stale, unmatched, deleted, or cross-workspace, show the recovery guidance instead of forcing an attachment.

## Validation Before Showing

Run the consolidated lane serially:

```bash
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm run lint
npm test
npm run test:integration
rm -rf .next && npm run build
npm run test:browser
npm run jobs:status
npm run jobs:run-once
git diff --check
```

The browser smoke lane already covers key pieces of this story: seeded page rendering, lead creation/conversion, Meeting Intelligence review and association correction, email review/sync health, Assistant review-first flows when explicitly included, quote creation/public acceptance, accepted quote sync conflict review, quote follow-up creation/completion, dashboard, and reports.
