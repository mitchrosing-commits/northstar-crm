# Northstar CRM Browser Smoke QA

Use this checklist after UI/layout changes to confirm the app still renders and remains usable in a real browser.

The project also has a tiny automated Playwright smoke lane. The manual checklist still exists for layout judgment and exploratory checks that are too broad for the automated smoke test.

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

- The dev server is running:

```bash
npm run dev
```

- Open the app at:

```text
http://localhost:3000/dashboard
```

Use the seeded workspace and development actor. By default, the app uses `alex@example.test`.

## Automated Smoke

Run the lightweight browser smoke test with:

```bash
npm run test:browser
```

The automated smoke test starts a local Next.js dev server on port `3100`, discovers seeded detail links from list pages, and checks:

- Key desktop pages render without app-level failures.
- The login page exposes the forgot-password link, the forgot-password page renders, and an invalid reset link fails safely.
- The Settings page renders the Account area with a display-name form and read-only email field.
- A small mobile/narrow subset renders.
- One seeded deal detail page shows the unified Timeline section.
- One closed seeded deal detail page shows the Reopen deal action.

It intentionally does not cover screenshot regression, visual diffing, every form, every interaction, auth flows, drag-and-drop, integrations, permission-boundary matrices, or a full E2E matrix. Role/account permission boundaries are pinned in source and integration tests instead.

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
- [ ] `/search?q=orbit`
- [ ] `/custom-fields`
- [ ] `/settings`
- [ ] `/settings/import-export`

For detail pages, open a real seeded record from the matching list page.

## Narrow Viewport

Use a narrow/mobile-ish width, roughly `390px` wide.

Check each page:

- [ ] `/dashboard`
- [ ] `/pipeline`
- [ ] `/deals`
- [ ] One seeded `/deals/[dealId]`
- [ ] `/activities`
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
npm run test:browser
npm run prisma:validate
npm run test
npm run lint
npm run typecheck
npm run build
```

Run `npm run test:integration` as well when the change could affect service/API behavior or when a guarded `TEST_DATABASE_URL` is available and you want the full stabilization lane.
