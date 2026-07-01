import { expect, type Page, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { generatePublicQuoteToken } from "@/lib/services/quote-service";

const prisma = new PrismaClient();
const smokeIds = {
  dealLineItemId: "",
  productId: "",
  publicLinkId: "",
  quoteId: "",
  quoteItemId: ""
};
let browserFlowSuffix = "";

let smokeQuote: { dealId: string; quoteId: string; token: string };
let communicationDealPath: string;

test.describe("Northstar CRM browser smoke", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    smokeQuote = await createSmokeQuote();
    communicationDealPath = await communicationDealDetailPath();
  });

  test.afterAll(async () => {
    await cleanupSmokeQuote();
    await cleanupBrowserFlowRecords();
    await prisma.$disconnect();
  });

  test("renders key seeded CRM pages and detail views", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dealHref = await firstDetailHref(page, "/deals", "/deals/");
    const leadHref = await firstDetailHref(page, "/leads", "/leads/");
    const contactHref = await firstDetailHref(page, "/contacts", "/contacts/");
    const organizationHref = await firstDetailHref(page, "/organizations", "/organizations/");

    await expectPageReady(page, "/login", { requireAppShell: false });
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
    await expectPageReady(page, "/signup", { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await expectPageReady(page, "/forgot-password", { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
    await expectPageReady(page, "/reset-password?token=invalid-smoke-token", { requireAppShell: false });
    await expect(page.getByText("This password reset link is invalid or expired.")).toBeVisible();

    for (const path of [
      "/",
      "/dashboard",
      "/pipeline",
      "/deals",
      "/deals/new",
      dealHref,
      communicationDealPath,
      "/leads",
      "/leads/new",
      leadHref,
      "/contacts",
      "/contacts/new",
      contactHref,
      "/organizations",
      "/organizations/new",
      organizationHref,
      "/activities",
      "/activities/new",
      "/email",
      "/products",
      "/reports",
      "/search?q=orbit",
      "/custom-fields",
      "/settings",
      "/settings/import-export",
      "/settings/developer-api"
    ]) {
      await expectPageReady(page, path);
      if (path === dealHref || path === communicationDealPath) {
        await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Log Manual Email" })).toBeVisible();
        await expect(page.getByText("Manual", { exact: true })).toBeVisible();
      }
      if (path === communicationDealPath) {
        await expect(page.getByText("Quote shared for manager training package")).toBeVisible();
        await expect(page.getByText("Logged outbound email")).toBeVisible();
        const contractWorkflow = page.locator(".contract-workflow-panel");
        await expect(contractWorkflow.getByRole("heading", { name: "Contract Workflow" })).toBeVisible();
        await expect(contractWorkflow.getByText("NDA Status")).toBeVisible();
        await expect(contractWorkflow.getByText("MSA Status")).toBeVisible();
        await expect(contractWorkflow.getByText("SOW Status")).toBeVisible();
        await expect(contractWorkflow.locator(".contract-status-chip").getByText("Signed", { exact: true })).toBeVisible();
        await expect(contractWorkflow.locator(".contract-status-chip").getByText("Sent", { exact: true })).toBeVisible();
        await expect(contractWorkflow.locator(".contract-status-chip").getByText("In Review", { exact: true })).toBeVisible();
      }
      if (path === "/dashboard") {
        await expect(page.getByRole("heading", { name: "Active Deals" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Priority Activities" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Recent Quotes" })).toBeVisible();
        const dashboardDealHref = await firstHref(page, "/deals/");
        expect(dashboardDealHref, "Expected dashboard to include a deal detail link").toBeTruthy();
        const dashboardQuoteHref = await firstQuoteHref(page);
        expect(dashboardQuoteHref, "Expected dashboard to include a quote detail link").toBeTruthy();
        const settingsShortcut = page.locator('a.sidebar-settings-link[href="/settings"]');
        expect(await settingsShortcut.count(), "Expected one persistent Settings shortcut in the app shell").toBe(1);
        await expect(settingsShortcut, "Expected Settings shortcut to be visible in the app shell").toBeVisible();
        await settingsShortcut.click();
        await expect(page.getByRole("heading", { exact: true, name: "Settings" })).toBeVisible();
      }
      if (path === "/pipeline") {
        const contractSummaries = page.locator(".contract-status-summary");
        expect(await contractSummaries.count(), "Expected pipeline cards to include contract summaries").toBeGreaterThan(0);
        await expect(page.getByText("NDA").first()).toBeVisible();
        await expect(page.getByText("MSA").first()).toBeVisible();
        await expect(page.getByText("SOW").first()).toBeVisible();
      }
      if (path === "/deals/new") {
        await expect(page.getByRole("heading", { name: "New deal" })).toBeVisible();
        await expect(page.getByLabel("Title")).toBeVisible();
      }
      if (path === "/contacts/new") {
        await expect(page.getByRole("heading", { name: "New Contact" })).toBeVisible();
        await expect(page.getByLabel("Name")).toBeVisible();
      }
      if (path === "/organizations/new") {
        await expect(page.getByRole("heading", { name: "New Organization" })).toBeVisible();
        await expect(page.getByLabel("Name")).toBeVisible();
      }
      if (path === "/leads/new") {
        await expect(page.getByRole("heading", { name: "New Lead" })).toBeVisible();
        await expect(page.getByLabel("Title")).toBeVisible();
      }
      if (path === "/activities/new") {
        await expect(page.getByRole("heading", { name: "New Activity" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Create Follow-up" })).toBeVisible();
      }
      if (path === "/deals") {
        await expect(page.getByRole("heading", { name: "Saved deal views" })).toBeVisible();
      }
      if (path === "/leads") {
        await expect(page.getByRole("heading", { name: "Saved lead views" })).toBeVisible();
      }
      if (path === "/contacts") {
        await expect(page.getByRole("heading", { name: "Saved contact views" })).toBeVisible();
      }
      if (path === "/organizations") {
        await expect(page.getByRole("heading", { name: "Saved organization views" })).toBeVisible();
      }
      if (path === "/activities") {
        await expect(page.getByRole("heading", { name: "Quick activity links" })).toBeVisible();
        await expect(page.getByRole("link", { name: "My open" })).toBeVisible();
      }
      if (path === "/email") {
        await expect(page.getByRole("heading", { name: "Email Providers" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Gmail" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Google Workspace" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Microsoft 365" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Outlook" })).toBeVisible();
        await expect(page.getByText("IMAP/SMTP is planned as a fallback for Yahoo Mail")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Synced Emails" })).toBeVisible();
        const overflowingProviderCards = await page.locator(".provider-card").evaluateAll((cards) =>
          cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length
        );
        expect(overflowingProviderCards, "Expected provider card text and controls to stay inside their cards").toBe(0);
      }
      if (path === "/products") {
        await expect(page.getByRole("heading", { name: "Product Catalog" })).toBeVisible();
        expect(await page.locator(".product-catalog-card").count(), "Expected seeded products to render as cards").toBeGreaterThan(0);
        const overflowingProductCards = await page.locator(".product-catalog-card").evaluateAll((cards) =>
          cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length
        );
        expect(overflowingProductCards, "Expected product card text and edit controls to stay inside their cards").toBe(0);
      }
      if (path === "/settings") {
        await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
        await expect(page.getByLabel("Display name")).toBeVisible();
        await expect(page.locator("#account-email")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Email Connections" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Gmail / Google Workspace" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Microsoft 365 / Outlook" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "IMAP / SMTP" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Open API surface" })).toBeVisible();
        expect(await page.getByText("Not configured").count()).toBeGreaterThanOrEqual(1);
        await expect(page.getByRole("button", { name: "Planned" })).toBeDisabled();
      }
      if (path === "/settings/import-export") {
        await expect(page.getByRole("heading", { name: "Deals Import Preview" })).toBeVisible();
        await expect(page.getByLabel("Deals CSV")).toBeVisible();
        for (const resource of ["deals", "contacts", "organizations", "activities", "quotes"]) {
          const exportResponse = await page.context().request.get(`/api/v1/workspaces/${await demoWorkspaceId()}/exports/${resource}`);
          expect(exportResponse.ok(), `Expected ${resource} export to return ok`).toBeTruthy();
          expect(exportResponse.headers()["content-type"]).toContain("text/csv");
          const csv = await exportResponse.text();
          expect(csv).toContain("createdAt");
          expect(csv.split("\n").length, `Expected ${resource} export to include seeded rows`).toBeGreaterThan(1);
        }
      }
      if (path === "/settings/developer-api") {
        await expect(page.getByRole("heading", { name: "Developer / API" })).toBeVisible();
        await expect(page.getByText("/api/v1/workspaces/")).toBeVisible();
        await expect(page.getByText("docs/openapi.yaml")).toBeVisible();
        await expect(page.getByText("docs/api-route-map.md")).toBeVisible();
        await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
        await expect(page.getByText("CSV exports are REST endpoints")).toBeVisible();
        await expect(page.getByRole("button", { name: "Coming soon" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Planned" })).toHaveCount(2);
      }
      if (path === "/reports") {
        await expect(page.getByRole("heading", { name: "Goals v1" })).toBeVisible();
        await expect(page.getByText("not expected close date")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Forecasting v1" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Activity Status Summary" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Quote Status Summary" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Top Open Deals" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Top Organizations" })).toBeVisible();
        await expect(page.getByRole("link", { name: "View open deals" })).toBeVisible();
      }
    }
  });

  test("creates linked CRM records and completes a follow-up from the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    browserFlowSuffix = Date.now().toString(36);
    const organizationName = `Browser Flow Organization ${browserFlowSuffix}`;
    const contactName = `Browser Flow Contact ${browserFlowSuffix}`;
    const dealTitle = `Browser Flow Deal ${browserFlowSuffix}`;
    const activityTitle = `Browser Flow Follow-up ${browserFlowSuffix}`;

    await expectPageReady(page, "/organizations/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Name").fill(organizationName);
    await page.getByLabel("Domain").fill(`browser-flow-${browserFlowSuffix}.example`);
    const organizationResponse = waitForWorkspaceApiResponse(page, "POST", "/organizations");
    await page.getByRole("button", { name: "Create organization" }).click();
    await expectApiOk(organizationResponse, "Expected organization create API to succeed");
    const organizationPath = await waitForDetailPath(page, "/organizations/");
    await expect(page.getByRole("heading", { name: organizationName })).toBeVisible();

    await expectPageReady(page, "/contacts/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Name").fill(contactName);
    await page.getByLabel("Email").fill(`browser-flow-${browserFlowSuffix}@example.test`);
    await page.getByLabel("Phone").fill("555-0101");
    await page.getByLabel("Organization").selectOption({ label: organizationName });
    const contactResponse = waitForWorkspaceApiResponse(page, "POST", "/people");
    await page.getByRole("button", { name: "Create contact" }).click();
    await expectApiOk(contactResponse, "Expected contact create API to succeed");
    const contactPath = await waitForDetailPath(page, "/contacts/");
    await expect(page.getByRole("heading", { name: contactName })).toBeVisible();
    await expect(page.getByRole("link", { name: organizationName })).toHaveAttribute("href", organizationPath);

    await expectPageReady(page, "/deals/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Title").fill(dealTitle);
    await page.getByLabel("Value").fill("12345.67");
    await page.getByLabel("Currency").fill("USD");
    await page.getByLabel("Person").selectOption({ label: contactName });
    await page.getByLabel("Organization").selectOption({ label: organizationName });
    await expect(page.getByRole("button", { name: "Create deal" })).toBeEnabled();
    const dealResponse = waitForWorkspaceApiResponse(page, "POST", "/deals");
    await page.getByRole("button", { name: "Create deal" }).click();
    await expectApiOk(dealResponse, "Expected deal create API to succeed");
    const dealPath = await waitForDetailPath(page, "/deals/");
    await expect(page.getByRole("heading", { name: dealTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: contactName })).toHaveAttribute("href", contactPath);
    await expect(page.getByRole("link", { name: organizationName })).toHaveAttribute("href", organizationPath);

    const addActivity = page.locator("#add-activity");
    await addActivity.getByLabel("Title").fill(activityTitle);
    await addActivity.getByLabel("Type").selectOption("CALL");
    await addActivity.getByLabel("Due date").fill("2026-07-15");
    await addActivity.getByLabel("Description").fill("Created by the browser regression workflow.");
    const activityResponse = waitForWorkspaceApiResponse(page, "POST", "/activities");
    await addActivity.getByRole("button", { name: "Add activity" }).click();
    await expectApiOk(activityResponse, "Expected activity create API to succeed");

    const openNextSteps = page.locator(".data-card").filter({
      has: page.getByRole("heading", { name: "Open Next Steps" })
    });
    await expect(openNextSteps.getByText(activityTitle)).toBeVisible();
    const completeResponse = waitForWorkspaceApiResponse(page, "PATCH", "/activities/");
    await openNextSteps.getByRole("button", { name: "Mark complete" }).click();
    await expectApiOk(completeResponse, "Expected activity completion API to succeed");

    const completedHistory = page.locator(".data-card").filter({
      has: page.getByRole("heading", { name: "Completed Activity History" })
    });
    await expect(completedHistory.getByText(activityTitle)).toBeVisible();

    await expectPageReady(page, contactPath);
    await expect(page.getByRole("link", { name: dealTitle })).toHaveAttribute("href", dealPath);
    await expectPageReady(page, organizationPath);
    await expect(page.getByRole("link", { name: contactName })).toHaveAttribute("href", contactPath);
    await expect(page.getByRole("link", { name: dealTitle })).toHaveAttribute("href", dealPath);
  });

  test("renders a small mobile viewport subset", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dealHref = await firstDetailHref(page, "/deals", "/deals/");

    for (const path of ["/dashboard", "/deals", dealHref, "/activities", "/custom-fields"]) {
      await expectPageReady(page, path);
    }
  });

  test("shows reopen action for a closed seeded deal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const closedDealHref = await closedDealHrefFromList(page);

    await expectPageReady(page, closedDealHref);
    await expect(page.getByRole("button", { name: "Reopen deal" })).toBeVisible();
  });

  test("renders internal and public quote routes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const quotePath = `/deals/${smokeQuote.dealId}/quotes/${smokeQuote.quoteId}`;
    await expectPageReady(page, quotePath);
    await expect(page.getByRole("heading", { name: /Q-SMOKE-/ })).toBeVisible();
    await expect(page.getByText("Internal quote")).toBeVisible();
    await expect(page.getByText("Internal tracking only")).toBeVisible();

    await expectPageReady(page, `${quotePath}/print`);
    await expect(page.getByRole("button", { name: "Print quote" })).toBeVisible();

    const pdfResponse = await page.context().request.get(`${quotePath}/pdf`);
    expect(pdfResponse?.ok(), "Expected quote PDF route to return ok").toBeTruthy();
    expect(pdfResponse?.headers()["content-type"]).toContain("application/pdf");
    expect(pdfResponse?.headers()["content-disposition"]).toContain("Q-SMOKE-");

    await expectPageReady(page, `/q/${smokeQuote.token}`, { requireAppShell: false });
    await expect(page.getByRole("heading", { name: /Q-SMOKE-/ })).toBeVisible();
    await expect(page.getByText("Customer-facing quote view")).toBeVisible();
    await expect(page.getByText("automatically update internal deal value")).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);
  });
});

async function firstDetailHref(page: Page, listPath: string, hrefPrefix: string) {
  await expectPageReady(page, listPath);
  const href = await firstHref(page, hrefPrefix);
  expect(href, `Expected ${listPath} to include a seeded detail link`).toBeTruthy();
  return href;
}

async function waitForDetailPath(page: Page, prefix: string) {
  await page.waitForURL((url) => {
    const path = url.pathname;
    return path.startsWith(prefix) && !path.endsWith("/new") && !path.endsWith("/edit");
  });
  return new URL(page.url()).pathname;
}

async function waitForWorkspaceApiResponse(page: Page, method: string, pathSuffix: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.startsWith("/api/v1/workspaces/") &&
      url.pathname.includes(pathSuffix) &&
      response.request().method() === method
    );
  });
}

async function expectApiOk(responsePromise: Promise<Awaited<ReturnType<Page["waitForResponse"]>>>, message: string) {
  const response = await responsePromise;
  expect(response.ok(), message).toBeTruthy();
}

async function closedDealHrefFromList(page: Page) {
  for (const status of ["LOST", "WON"]) {
    await expectPageReady(page, `/deals?status=${status}&pageSize=50`);
    const href = await firstHref(page, "/deals/");
    if (href) return href;
  }

  throw new Error("Expected seeded data to include at least one WON or LOST deal.");
}

async function firstHref(page: Page, hrefPrefix: string) {
  return page.locator(`a[href^="${hrefPrefix}"]`).evaluateAll((links, prefix) => {
    const values = links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .filter((href) => href.startsWith(String(prefix)))
      .filter((href) => !href.endsWith("/new") && !href.endsWith("/edit") && !href.includes("/edit?"));

    return values[0] ?? null;
  }, hrefPrefix);
}

async function firstQuoteHref(page: Page) {
  return page.locator('a[href*="/quotes/"]').evaluateAll((links) => {
    const values = links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .filter((href) => href.startsWith("/deals/") && href.includes("/quotes/"));

    return values[0] ?? null;
  });
}

async function expectPageReady(page: Page, path: string, options: { requireAppShell?: boolean } = {}) {
  const requireAppShell = options.requireAppShell ?? true;
  const errors: string[] = [];
  const serverErrors: string[] = [];
  const onResponse = (response: Awaited<ReturnType<Page["waitForResponse"]>>) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  };

  page.once("pageerror", (error) => errors.push(error.message));
  page.on("response", onResponse);

  try {
    const response = await page.goto(path);
    const bodyText = (await page.locator("body").textContent({ timeout: 5_000 })) ?? "";

    expect(response?.ok(), `Expected ${path} to return an ok response`).toBeTruthy();
    expect(response?.status(), `Expected ${path} not to return a server error`).toBeLessThan(500);
    expect(bodyText).not.toContain("Application error");
    expect(bodyText).not.toContain("Internal Server Error");
    expect(bodyText).not.toContain("PrismaClientKnownRequestError");
    expect(bodyText).not.toContain("P2022");
    expect(bodyText).not.toContain("This site can't be reached");
    if (requireAppShell) await expect(page.locator("main")).toBeVisible();
    expect(errors, `Unexpected browser error on ${path}`).toEqual([]);
    expect(serverErrors, `Unexpected 5xx response while loading ${path}`).toEqual([]);
  } finally {
    page.off("response", onResponse);
  }
}

async function createSmokeQuote() {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  const deal = await prisma.deal.findFirstOrThrow({
    where: { workspaceId: workspace.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const suffix = Date.now().toString(36);
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      name: `Smoke product ${suffix}`,
      description: "Browser smoke product",
      unitPriceCents: 123400,
      currency: "USD"
    }
  });
  smokeIds.productId = product.id;

  const lineItem = await prisma.dealLineItem.create({
    data: {
      workspaceId: workspace.id,
      dealId: deal.id,
      productId: product.id,
      productName: product.name,
      description: product.description,
      quantity: 1,
      unitPriceCents: product.unitPriceCents,
      lineTotalCents: product.unitPriceCents,
      currency: product.currency
    }
  });
  smokeIds.dealLineItemId = lineItem.id;

  const quote = await prisma.quote.create({
    data: {
      workspaceId: workspace.id,
      dealId: deal.id,
      number: `Q-SMOKE-${suffix}`,
      status: "SENT",
      currency: "USD",
      subtotalCents: lineItem.lineTotalCents,
      totalCents: lineItem.lineTotalCents
    }
  });
  smokeIds.quoteId = quote.id;

  const quoteItem = await prisma.quoteItem.create({
    data: {
      workspaceId: workspace.id,
      quoteId: quote.id,
      dealLineItemId: lineItem.id,
      productId: product.id,
      name: lineItem.productName,
      description: lineItem.description,
      quantity: lineItem.quantity,
      unitPriceCents: lineItem.unitPriceCents,
      lineTotalCents: lineItem.lineTotalCents,
      currency: lineItem.currency
    }
  });
  smokeIds.quoteItemId = quoteItem.id;

  const publicLink = await prisma.quotePublicLink.create({
    data: {
      workspaceId: workspace.id,
      quoteId: quote.id,
      token: generatePublicQuoteToken()
    }
  });
  smokeIds.publicLinkId = publicLink.id;

  return { dealId: deal.id, quoteId: quote.id, token: publicLink.token };
}

async function communicationDealDetailPath() {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  const deal = await prisma.deal.findFirstOrThrow({
    where: { workspaceId: workspace.id, title: "Atlas manager training package", deletedAt: null },
    select: { id: true }
  });
  return `/deals/${deal.id}`;
}

async function demoWorkspaceId() {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  return workspace.id;
}

async function cleanupSmokeQuote() {
  if (smokeIds.publicLinkId) await prisma.quotePublicLink.deleteMany({ where: { id: smokeIds.publicLinkId } });
  if (smokeIds.quoteItemId) await prisma.quoteItem.deleteMany({ where: { id: smokeIds.quoteItemId } });
  if (smokeIds.quoteId) await prisma.quote.deleteMany({ where: { id: smokeIds.quoteId } });
  if (smokeIds.dealLineItemId) await prisma.dealLineItem.deleteMany({ where: { id: smokeIds.dealLineItemId } });
  if (smokeIds.productId) await prisma.product.deleteMany({ where: { id: smokeIds.productId } });
}

async function cleanupBrowserFlowRecords() {
  if (!browserFlowSuffix) return;

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  const [deals, people, organizations] = await Promise.all([
    prisma.deal.findMany({
      where: { workspaceId: workspace.id, title: { contains: browserFlowSuffix } },
      select: { id: true }
    }),
    prisma.person.findMany({
      where: { workspaceId: workspace.id, email: `browser-flow-${browserFlowSuffix}@example.test` },
      select: { id: true }
    }),
    prisma.organization.findMany({
      where: { workspaceId: workspace.id, name: { contains: browserFlowSuffix } },
      select: { id: true }
    })
  ]);
  const dealIds = deals.map((deal) => deal.id);
  const personIds = people.map((person) => person.id);
  const organizationIds = organizations.map((organization) => organization.id);
  const activities = await prisma.activity.findMany({
    where: {
      workspaceId: workspace.id,
      OR: [
        { title: { contains: browserFlowSuffix } },
        { dealId: { in: dealIds } },
        { personId: { in: personIds } },
        { organizationId: { in: organizationIds } }
      ]
    },
    select: { id: true }
  });
  const activityIds = activities.map((activity) => activity.id);
  const entityIds = [...activityIds, ...dealIds, ...personIds, ...organizationIds];

  if (entityIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { workspaceId: workspace.id, entityId: { in: entityIds } } });
  }
  if (activityIds.length > 0) await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
  if (dealIds.length > 0) await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
  if (personIds.length > 0) await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  if (organizationIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
}
