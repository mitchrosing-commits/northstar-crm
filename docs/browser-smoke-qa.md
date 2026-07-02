# Northstar CRM Browser Smoke QA

Use this checklist after UI/layout changes to confirm the app still renders and remains usable in a real browser.

The project also has a focused automated Playwright smoke lane. The manual checklist still exists for layout judgment and exploratory checks that are too broad for the automated smoke test.

## Prerequisites

- PostgreSQL is running and `DATABASE_URL` points at the local development database.
- The local development database has applied committed migrations after the latest pull:

```bash
npm run prisma:deploy
```

- Demo data has been seeded:

```bash
npm run prisma:seed
```

- For the manual checklist, the dev server is running:

```bash
npm run dev
```

- Open the app at:

```text
http://localhost:3000/dashboard
```

Use the seeded workspace and development actor. By default, the app uses `alex@example.test`.

Stop the dev server before running the automated production-build smoke lane below, because `npm run build` and a live Next.js dev server can both touch `.next`.

## Automated Smoke

Build the production app before running the automated smoke lane:

```bash
npm run build
```

Run the lightweight browser smoke test with:

```bash
npm run test:browser
```

The automated smoke test starts a local `next start` server on port `3100`, so it requires the `.next` production build output from `npm run build`. It discovers seeded detail links from list pages and checks:

- Key desktop pages render without app-level failures.
- The login page exposes the forgot-password link, the forgot-password page renders, and an invalid reset link fails safely.
- The Settings page renders the Account area with a display-name form and read-only email field.
- A small mobile/narrow subset renders.
- One seeded deal detail page shows the unified Timeline section.
- One closed seeded deal detail page shows the Reopen deal action.
- The Settings Import/Export page renders and the browser session can download Deals, Contacts, Organizations, Leads, Activities, Products, and Quotes CSV exports with private no-store CSV responses.
- Product, Reports, Email Command Center, Developer/API, and Custom Fields pages render their primary readiness content.
- Authenticated quote detail, quote print, authenticated quote PDF, and public quote routes render without exposing the CRM app shell on the public route.
- A real browser create flow can add linked organization/contact/deal records, complete a follow-up, and then find those records from related detail pages.
- A real browser lead flow can create a lead, log email context, convert it into a deal, verify the email context moves to the converted deal, and verify the converted lead is locked.
- A real browser password-reset flow can submit the request form for a temporary user, verify a reset token is created, and complete the reset form with a seeded valid token without requiring a configured email provider.

It intentionally does not cover screenshot regression, visual diffing, every form, every interaction, full signup/login session matrices, drag-and-drop, live integrations, permission-boundary matrices, or a full E2E matrix. Role/account permission boundaries are pinned in source and integration tests instead.

If the smoke server reports missing `.next` manifests, missing production build ids, missing vendor chunks, or repeated server restarts, stop active Next.js servers before rebuilding. The normal `npm run test:browser` command starts `next start` on port `3100` with local auth settings for the smoke-created session. For a stable manual verification lane, run a clean production build, start the same local-auth server yourself, and tell Playwright to reuse it:

```bash
rm -rf .next
npm run build
AUTH_MODE=local AUTH_SESSION_SECRET=browser-smoke-session-secret-32-chars-minimum npm run start -- --hostname 127.0.0.1 --port 3100
PLAYWRIGHT_REUSE_SERVER=1 npm run test:browser -- --project=chromium
```

Do not run `npm run build` while a dev server is serving the same `.next` directory.
Also avoid running `npm run build` at the same time as `npm run typecheck`; both can touch or read generated `.next/types` files, which can create false missing-file failures unrelated to application code. The `typecheck` script disables TypeScript incremental cache reads, but it still depends on a stable generated `.next/types` directory while the command is running.
The automated smoke test retries a single known transient `ChunkLoadError` on direct page loads and the app-shell Settings shortcut because stale local Next chunks can briefly surface after rebuilds. Repeated chunk-load failures still mean the local `.next`/server state should be cleaned up with the production-build lane above.

## Desktop Viewport

Use a normal desktop browser width, roughly `1280px` wide or larger.

Check each page:

- [ ] `/dashboard`
- [ ] `/pipeline`
- [ ] `/deals`
- [ ] `/deals/new`
- [ ] One seeded `/deals/[dealId]`
- [ ] `/leads`
- [ ] One seeded `/leads/[leadId]`
- [ ] `/contacts`
- [ ] One seeded `/contacts/[personId]`
- [ ] `/organizations`
- [ ] One seeded `/organizations/[organizationId]`
- [ ] `/activities`
- [ ] `/email`
- [ ] `/products`
- [ ] `/reports`
- [ ] `/search?q=orbit`
- [ ] `/custom-fields`
- [ ] `/settings`
- [ ] `/settings/import-export`
- [ ] `/settings/developer-api`

For detail pages, open a real seeded record from the matching list page.
For quotes, open a seeded quote from Dashboard or a deal detail page, then verify the internal quote detail, print view, PDF download, and public quote link behavior if a public link exists.

## Narrow Viewport

Use a narrow/mobile-ish width, roughly `390px` wide.

Check each page:

- [ ] `/dashboard`
- [ ] `/pipeline`
- [ ] `/deals`
- [ ] One seeded `/deals/[dealId]`
- [ ] `/leads`
- [ ] One seeded `/leads/[leadId]`
- [ ] `/contacts`
- [ ] One seeded `/contacts/[personId]`
- [ ] `/organizations`
- [ ] One seeded `/organizations/[organizationId]`
- [ ] `/activities`
- [ ] `/email`
- [ ] `/search?q=orbit`
- [ ] `/settings`
- [ ] `/settings/import-export`
- [ ] `/custom-fields`

## What To Look For

- Blank pages or missing primary content.
- Runtime errors, application error overlays, hydration warnings, or connection failures.
- Page-level horizontal overflow. Internal table or Kanban scrolling is acceptable when intentional.
- Navigation that is hard to reach or unusable on narrow screens.
- Filter panels that cannot be read, reached, or submitted.
- Pagination controls wrapping badly or becoming hard to use.
- Forms with missing labels, clipped controls, or unusable buttons.
- Tables that fail to scroll predictably on narrow screens.
- Obvious focus/accessibility regressions, such as invisible keyboard focus or controls that cannot be reached by tabbing.

## Expected Smoke Signals

- The sidebar/nav appears on desktop and wraps into usable rows on narrow screens.
- `/pipeline` may scroll horizontally inside the Kanban board.
- List pages keep filters, tables, and pagination usable.
- Tables may scroll inside their panels/cards on narrow screens instead of widening the whole page.
- Detail pages show linked activities, notes, and related records without layout overflow.
- `/custom-fields` shows Deal, Contact, Organization, and Lead fields plus the New Custom Field form without page-level horizontal scrolling.

## After Fixes

After any browser-smoke fix, run:

```bash
npm run prisma:validate
npm run test
npm run lint
npm run typecheck
npm run build
npm run test:browser
```

Run `npm run build` before `npm run test:browser` when validating a fresh checkout or after deleting `.next`; `test:browser` uses `next start` and needs the production build artifacts. Run `npm run typecheck` and `npm run build` one after the other, not in parallel, because the production build can regenerate `.next/types` while TypeScript is reading generated route types.

Run `npm run test:integration` as well when the change could affect service/API behavior or when a guarded `TEST_DATABASE_URL` is available and you want the full stabilization lane.
