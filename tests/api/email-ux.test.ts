import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const emailActions = readFileSync(join(process.cwd(), "app/email/actions.ts"), "utf8");
const emailService = readFileSync(join(process.cwd(), "lib/services/email-service.ts"), "utf8");
const emailConnectionService = readFileSync(join(process.cwd(), "lib/services/email-connection-service.ts"), "utf8");
const emailDraftPanel = readFileSync(join(process.cwd(), "components/email-draft-panel.tsx"), "utf8");
const manualEmailPanel = readFileSync(join(process.cwd(), "components/manual-email-log-panel.tsx"), "utf8");
const middleware = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("Email UX v1 discoverability", () => {
  it("adds Email to the authenticated app navigation and protected-route guard", () => {
    expect(primaryNav).toContain("Inbox");
    expect(primaryNav).toContain("href: \"/email\"");
    expect(primaryNav).toContain("label: \"Email\"");
    expect(middleware).toContain("\"/email\"");
    expect(middleware).toContain("loginUrl.pathname = \"/login\"");
    expect(middleware).toContain("loginUrl.searchParams.set(\"next\"");
  });

  it("renders a workspace-scoped operational email page with honest Gmail scope copy", () => {
    expect(emailPage).toContain("getCurrentWorkspaceContext()");
    expect(emailPage).toContain("listEmailConnectionProviderCards(actor)");
    expect(emailPage).toContain("listEmailLogs(actor, { limit: 25 })");
    expect(emailPage).toContain("<AppShell workspace={workspace}>");
    expect(emailPage).toContain("Email Providers");
    expect(emailPage).toContain("Northstar syncs recent email metadata/snippets from connected providers");
    expect(emailPage).toContain("does not import");
    expect(emailPage).toContain("full inboxes");
    expect(emailPage).toContain("attachments");
    expect(emailPage).toContain("full message bodies");
    expect(emailPage).toContain("send email yet");
    expect(emailPage).toContain("Unmatched");
    expect(emailPage).toContain("messages are skipped.");
    expect(emailPage).toContain("majorProviderCards.map");
    expect(emailPage).toContain("provider.name");
    expect(emailService).toContain("where: { workspaceId: actor.workspaceId }");
  });

  it("shows four major provider cards with honest Google and Microsoft provider paths", () => {
    expect(emailPage).toContain("buildMajorProviderCards");
    expect(emailPage).toContain("name: \"Gmail\"");
    expect(emailPage).toContain("name: \"Google Workspace\"");
    expect(emailPage).toContain("name: \"Microsoft 365\"");
    expect(emailPage).toContain("name: \"Outlook\"");
    expect(emailPage).toContain("provider.disabled || !provider.href");
    expect(emailPage).toContain("disabled type=\"button\"");
    expect(emailPage).toContain("provider.actionLabel");
    expect(emailPage).toContain("provider.syncAvailable");
    expect(emailPage).toContain("syncRecentGmailFromEmailPageAction");
    expect(emailPage).toContain("syncRecentMicrosoftFromEmailPageAction");
    expect(emailPage).toContain("Sync recent Gmail");
    expect(emailPage).toContain("Sync recent Google Workspace");
    expect(emailPage).toContain("Sync recent Microsoft 365 mail");
    expect(emailPage).toContain("Sync recent Outlook mail");
    expect(emailPage).toContain("href={provider.href as Route}");
    expect(emailPage).toContain("Connected account: {provider.accountEmail}");
    expect(emailPage).toContain("Last sync: {formatDate(provider.lastSyncAt)}");
    expect(emailConnectionService).toContain("Connect Gmail");
    expect(emailConnectionService).toContain("Reconnect Gmail");
    expect(emailConnectionService).toContain("Connect Microsoft");
    expect(emailConnectionService).toContain("Reconnect Microsoft");
    expect(emailConnectionService).toContain("href: \"/api/email-connections/microsoft/connect\"");
    expect(emailPage).toContain("return `Connect ${label}`");
    expect(emailPage).toContain("return `Reconnect ${label}`");
    expect(emailPage).toContain("Microsoft 365 uses the Microsoft Graph provider path.");
    expect(emailPage).toContain("Outlook uses the Microsoft 365 / Microsoft Graph provider path.");
    expect(emailConnectionService).toContain("syncAvailable: connection?.status === \"CONNECTED\"");
    expect(emailConnectionService).toContain("Microsoft 365 / Outlook");
    expect(emailConnectionService).toContain("IMAP / SMTP");
    expect(emailConnectionService).toContain("Add the Microsoft OAuth client id, client secret, redirect URI, and token encryption key");
    expect(emailConnectionService).toContain("Planned fallback for Yahoo Mail, Zoho Mail, Fastmail, iCloud, custom domains, and hosting-provider email.");
    expect(emailConnectionService).toContain("disabled: true");
    expect(emailConnectionService).not.toContain("Yahoo OAuth");
    expect(emailPage).not.toContain("Yahoo OAuth");
  });

  it("runs manual Gmail sync from the email page and reports matched, duplicate, and skipped counts", () => {
    expect(emailActions).toContain("\"use server\"");
    expect(emailActions).toContain("syncRecentGmailMessages({ actor, maxResults: 10 })");
    expect(emailActions).toContain("/email?emailConnection=gmail-synced");
    expect(emailActions).toContain("created=${result.created}");
    expect(emailActions).toContain("duplicates=${result.skippedDuplicates}");
    expect(emailActions).toContain("skipped=${result.skippedUnmatched}");
    expect(emailActions).toContain("total=${result.totalFetched}");
    expect(emailActions).toContain("setEmailSyncReviewCookie");
    expect(emailActions).toContain("unmatchedPreviews: result.unmatchedPreviews");
    expect(emailActions).toContain("/email?emailConnection=gmail-sync-error");
    expect(emailPage).toContain("Latest Sync Result");
    expect(emailPage).toContain("Fetched");
    expect(emailPage).toContain("Logged");
    expect(emailPage).toContain("Duplicates");
    expect(emailPage).toContain("Unmatched");
    expect(emailPage).toContain("Recent Gmail sync finished.");
    expect(emailPage).toContain("skipped ${searchParams.skipped");
    expect(emailPage).toContain("duplicate");
  });

  it("renders command-center email cards with previews, attention badges, and linked CRM records", () => {
    expect(emailPage).toContain("Synced Emails");
    expect(emailPage).toContain("Suggested Follow-ups");
    expect(emailPage).toContain("EmailLogCard");
    expect(emailPage).toContain("emailNeedsAttention");
    expect(emailService).toContain("options: { limit?: number } = {}");
    expect(emailService).toContain("take");
    expect(emailPage).toContain("emailLog.subject");
    expect(emailPage).toContain("formatEmailProvider(emailLog.provider)");
    expect(emailPage).toContain("if (provider === \"GOOGLE_WORKSPACE\") return \"Gmail\"");
    expect(emailPage).toContain("if (provider === \"MICROSOFT_365\") return \"Microsoft\"");
    expect(emailPage).toContain("emailLog.direction === \"INBOUND\" ? \"From\" : \"To\"");
    expect(emailPage).toContain("emailLog.fromText");
    expect(emailPage).toContain("emailLog.toText");
    expect(emailPage).toContain("formatDate(emailLog.occurredAt)");
    expect(emailPage).toContain("formatEmailPreview(emailLog.body)");
    expect(emailPage).toContain("Follow-up suggested");
    expect(emailPage).toContain("Needs follow-up");
    expect(emailPage).toContain("Deal communication");
    expect(emailPage).toContain("/contacts/${emailLog.person.id}");
    expect(emailPage).toContain("/organizations/${emailLog.organization.id}");
    expect(emailPage).toContain("/deals/${emailLog.deal.id}");
    expect(emailPage).toContain("/leads/${emailLog.lead.id}");
    expect(emailPage).toContain("No linked CRM record");
    expect(emailPage).toContain("Create deal");
  });

  it("shows temporary unmatched email review with create-contact/create-lead actions", () => {
    expect(emailPage).toContain("Unmatched Email Review");
    expect(emailPage).toContain("Northstar is not storing unmatched inbox history.");
    expect(emailPage).toContain("EmailPreviewCard");
    expect(emailPage).toContain("Possible new contact");
    expect(emailPage).toContain("Create contact");
    expect(emailPage).toContain("Create lead");
    expect(emailPage).toContain("Ignore for now");
    expect(emailPage).toContain("buildContactHref");
    expect(emailPage).toContain("buildLeadHref");
    expect(emailPage).toContain("No matches yet");
  });

  it("adds follow-up drafting without send scopes or provider sending", () => {
    expect(emailPage).toContain("EmailDraftPanel");
    expect(emailDraftPanel).toContain("Draft only. Northstar does not send this email or request send scopes.");
    expect(emailDraftPanel).toContain("Copy draft");
    expect(emailDraftPanel).toContain("Open compose");
    expect(emailDraftPanel).toContain("mailto:");
    expect(emailDraftPanel).toContain("fallbackTemplates");
    expect(emailDraftPanel).toContain("Following up on this");
    expect(emailDraftPanel).toContain("Checking in");
    expect(emailDraftPanel).toContain("Quote / proposal follow-up");
    expect(emailConnectionService).not.toContain("Mail.Send");
    expect(emailConnectionService).not.toContain("gmail.send");
  });

  it("keeps empty email state and record-page email cues clear", () => {
    expect(emailPage).toContain("No email activity yet");
    expect(emailPage).toContain("Log an email manually from a deal, contact, organization, or lead.");
    expect(emailPage).toContain("After Gmail is connected");
    expect(emailPage).toContain("Connect Gmail / Google Workspace");
    expect(emailPage).toContain("Log an email manually");
    expect(manualEmailPanel).toContain("Log Manual Email");
    expect(manualEmailPanel).toContain("href={\"/email\" as Route}");
    expect(manualEmailPanel).toContain("sync recent matched messages from known contacts");
  });

  it("keeps Settings as configuration for connections and templates", () => {
    expect(settingsPage).toContain("id=\"email-connections\"");
    expect(settingsPage).toContain("<EmailTemplatesPanel");
    expect(settingsPage).toContain("Email Connections");
    expect(emailPage).toContain("href=\"/settings#email-connections\"");
    expect(emailPage).toContain("Email settings");
  });

  it("keeps provider cards resilient to long provider/account/status text", () => {
    expect(globalCss).toContain("grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))");
    expect(globalCss).toContain(".provider-card .badge");
    expect(globalCss).toContain("white-space: normal");
    expect(globalCss).toContain("overflow-wrap: anywhere");
    expect(globalCss).toContain(".provider-card .button-primary");
    expect(globalCss).toContain(".provider-card .button-secondary");
    expect(globalCss).toContain("word-break: break-word");
  });
});
