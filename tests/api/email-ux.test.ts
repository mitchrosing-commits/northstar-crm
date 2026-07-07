import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeEmailSyncReview,
  encodeEmailSyncReview,
} from "@/app/email/sync-review";

const primaryNav = readFileSync(
  join(process.cwd(), "components/primary-nav.tsx"),
  "utf8",
);
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const emailPage = readFileSync(
  join(process.cwd(), "app/email/page.tsx"),
  "utf8",
);
const personName = readFileSync(
  join(process.cwd(), "lib/person-name.ts"),
  "utf8",
);
const inlineEmptyStateText = readFileSync(
  join(process.cwd(), "components/inline-empty-state-text.tsx"),
  "utf8",
);
const emailActions = readFileSync(
  join(process.cwd(), "app/email/actions.ts"),
  "utf8",
);
const emailService = readFileSync(
  join(process.cwd(), "lib/services/email-service.ts"),
  "utf8",
);
const emailConnectionService = readFileSync(
  join(process.cwd(), "lib/services/email-connection-service.ts"),
  "utf8",
);
const emailDraftPanel = readFileSync(
  join(process.cwd(), "components/email-draft-panel.tsx"),
  "utf8",
);
const emailFollowUpPanel = readFileSync(
  join(process.cwd(), "components/email-follow-up-panel.tsx"),
  "utf8",
);
const manualEmailPanel = readFileSync(
  join(process.cwd(), "components/manual-email-log-panel.tsx"),
  "utf8",
);
const emailTemplatesPanel = readFileSync(
  join(process.cwd(), "app/settings/email-templates-panel.tsx"),
  "utf8",
);
const compactTitleRow = readFileSync(
  join(process.cwd(), "components/compact-title-row.tsx"),
  "utf8",
);
const middleware = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
const settingsPage = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);
const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const statCard = readFileSync(
  join(process.cwd(), "components/stat-card.tsx"),
  "utf8",
);

describe("Email UX v1 discoverability", () => {
  it("rejects malformed temporary email sync review cookies", () => {
    const validReview = {
      created: 1,
      duplicates: 0,
      provider: "Gmail" as const,
      skipped: 1,
      totalFetched: 2,
      unmatchedPreviews: [
        {
          direction: "INBOUND" as const,
          email: "buyer@example.test",
          fromText: "Buyer <buyer@example.test>",
          occurredAt: "2030-01-01T12:00:00.000Z",
          provider: "GOOGLE_WORKSPACE" as const,
          providerMessageId: "gmail-message-1",
          snippet: "Could not match this message.",
          subject: "Unmatched intro",
          toText: "sales@example.test",
        },
      ],
    };

    expect(decodeEmailSyncReview(encodeEmailSyncReview(validReview))).toEqual(
      validReview,
    );
    expect(
      decodeEmailSyncReview(
        Buffer.from(
          JSON.stringify({
            ...validReview,
            created: -1,
          }),
          "utf8",
        ).toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeEmailSyncReview(
        Buffer.from(
          JSON.stringify({
            ...validReview,
            provider: "IMAP",
            totalFetched: 1.5,
          }),
          "utf8",
        ).toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeEmailSyncReview(
        Buffer.from(
          JSON.stringify({
            ...validReview,
            unmatchedPreviews: [
              { ...validReview.unmatchedPreviews[0], providerMessageId: null },
            ],
          }),
          "utf8",
        ).toString("base64url"),
      ),
    ).toBeNull();
  });

  it("adds Inbox to the authenticated app navigation and protected-route guard", () => {
    expect(primaryNav).toContain("Inbox");
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(primaryNav).toContain("href={item.href}");
    expect(primaryNav).toContain("prefetch={true}");
    expect(primaryNav).toContain("pathname === hrefPath || pathname.startsWith(`${hrefPath}/`)");
    expect(navigation).toContain('href: "/email"');
    expect(navigation).toContain('label: "Inbox"');
    expect(middleware).toContain('"/email"');
    expect(middleware).toContain('loginUrl.pathname = "/login"');
    expect(middleware).toContain('loginUrl.searchParams.set("next"');
  });

  it("renders a workspace-scoped operational email page with honest Gmail scope copy", () => {
    expect(emailPage).toContain("getCurrentWorkspaceContext()");
    expect(emailPage).toContain("listEmailConnectionProviderCards(actor)");
    expect(emailPage).toContain("listEmailLogs(actor, { limit: 25 })");
    expect(emailPage).toContain("<AppShell workspace={workspace}>");
    expect(emailPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(emailPage).toContain('formatPersonName(emailLog.person) ?? "Unnamed contact"');
    expect(emailPage).not.toContain("[emailLog.person.firstName, emailLog.person.lastName].filter(Boolean).join(\" \")");
    expect(personName).toContain("export function formatPersonName");
    expect(emailPage).toContain(
      "Work synced mailbox threads, relationship-priority messages, Smart Labels, AI reply drafts, and review-first follow-ups from one place.",
    );
    expect(emailPage).toContain('className="panel inbox-workflow-map"');
    expect(emailPage).toContain('aria-label="Inbox workflow map"');
    expect(emailPage).toContain('title="Inbox Workflows"');
    expect(emailPage).toContain("Email intelligence lives inside the Inbox workflow.");
    expect(emailPage).toContain("Nothing here auto-sends, auto-classifies, creates CRM records, or creates follow-ups without review.");
    expect(emailPage).toContain("Full Inbox");
    expect(emailPage).toContain("Relationship Inbox");
    expect(emailPage).toContain("Smart Labels");
    expect(emailPage).toContain("AI Reply Assistant");
    expect(emailPage).toContain("Follow-ups");
    expect(emailPage).toContain('id="full-inbox"');
    expect(emailPage).toContain('aria-label="Full Inbox synced Gmail mailbox"');
    expect(emailPage).toContain('id="relationship-inbox"');
    expect(emailPage).toContain('aria-label="Relationship Inbox CRM priority queue"');
    expect(emailPage.indexOf('id="full-inbox"')).toBeLessThan(emailPage.indexOf('className="panel inbox-workflow-map"'));
    expect(emailPage.indexOf('id="full-inbox"')).toBeLessThan(emailPage.indexOf('title="Email Providers"'));
    expect(emailPage.indexOf('id="relationship-inbox"')).toBeGreaterThan(emailPage.indexOf('title="Email Providers"'));
    expect(emailPage).toContain("InboxWorkflowItem");
    expect(globalCss).toContain(".inbox-workflow-map");
    expect(globalCss).toContain(".inbox-workflow-grid");
    expect(globalCss).toContain(".inbox-workflow-item");
    expect(emailPage).toContain('const emailSettingsLabel = "Open email connection settings"');
    expect(emailPage).toContain("aria-label={emailSettingsLabel}");
    expect(emailPage).toContain("title={emailSettingsLabel}");
    expect(emailPage).toContain("Email Providers");
    expect(emailPage).toContain("PanelTitleRow");
    expect(emailPage).toContain("CompactTitleRow");
    expect(emailPage).toContain("FormIntroCallout");
    expect(emailPage).toContain('title="Email Providers"');
    expect(emailPage).toContain('title="Latest Sync Result"');
    expect(emailPage).toContain('title="Unmatched Email Review"');
    expect(emailPage).toContain('title="Suggested Follow-ups"');
    expect(emailPage).toContain('title="Stored Email History"');
    expect(emailPage).toContain('className="panel section-separated"');
    expect(emailPage).toContain("provider-card-grid section-spaced");
    expect(emailPage).toContain("EmailScopeCallout");
    expect(emailPage).toContain('title="Sync boundaries"');
    expect(emailPage).toContain('title="Provider roadmap"');
    expect(emailPage).toContain('title="Review scope"');
    expect(emailPage).toContain('className="email-scope-callout"');
    expect(emailPage).not.toContain("empty-copy email-section-copy");
    expect(emailPage).toContain('className="email-provider-empty"');
    expect(emailPage).not.toContain("empty-copy email-section-note");
    expect(emailPage).toContain('className="email-status-callout"');
    expect(emailPage).toContain('title="Provider status"');
    expect(globalCss).toContain(".email-scope-callout");
    expect(globalCss).toContain(".email-provider-empty");
    expect(globalCss).not.toContain(".email-section-note");
    expect(globalCss).toContain(".email-status-callout");
    expect(emailPage).toContain("EmptyState");
    expect(emailPage).toContain("gmailFullInboxReadiness(gmailProvider)");
    expect(emailPage).toContain('title: "Gmail setup required"');
    expect(emailPage).toContain('title: "Reconnect Gmail for Full Inbox"');
    expect(emailPage).toContain('title: "Token encryption required"');
    expect(emailPage).toContain("Connect Gmail with Full Inbox scopes");
    expect(emailPage).toContain('className="email-provider-empty"');
    expect(emailPage).not.toContain(
      '<div className="empty-state email-provider-empty">',
    );
    expect(emailPage).toContain('className="data-card section-separated"');
    expect(emailPage).toContain("Gmail Full Inbox sync stores recent inbox messages and full readable bodies");
    expect(emailPage).toContain("Replies");
    expect(emailPage).toContain("are sent only from an explicit user action");
    expect(emailPage).toContain("Microsoft sync remains metadata-focused and CRM-matched for now.");
    expect(emailPage).toContain("Unmatched");
    expect(emailPage).toContain("Northstar is not storing unmatched inbox history.");
    expect(emailPage).toContain("majorProviderCards.map");
    expect(emailPage).toContain("provider.name");
    expect(emailPage).toContain(
      "actions={<Badge>{provider.status}</Badge>}",
    );
    expect(emailPage).toContain('import { Badge } from "@/components/badge"');
    expect(emailPage).toContain("title={provider.name}");
    expect(emailPage).not.toContain("<h3>{provider.name}</h3>");
    expect(emailService).toContain("workspaceId: actor.workspaceId");
    expect(emailService).toContain(
      "emailLogAttachmentRelationsWhere(actor.workspaceId)",
    );
  });

  it("shows four major provider cards with honest Google and Microsoft provider paths", () => {
    expect(emailPage).toContain("buildMajorProviderCards");
    expect(emailPage).toContain('name: "Gmail"');
    expect(emailPage).toContain('name: "Google Workspace"');
    expect(emailPage).toContain('name: "Microsoft 365"');
    expect(emailPage).toContain('name: "Outlook"');
    expect(emailPage).toContain("provider.disabled || !provider.href");
    expect(emailPage).toContain("disabled");
    expect(emailPage).toContain('type="button"');
    expect(emailPage).toContain("provider.actionLabel");
    expect(emailPage).toContain(
      "const providerActionsLabel = `${provider.name} provider actions`",
    );
    expect(emailPage).toContain(
      "const providerPrimaryActionLabel = `${provider.actionLabel}: ${provider.name} provider setup`",
    );
    expect(emailPage).toContain(
      "const providerSyncLabel = provider.syncLabel ?? \"Sync recent Gmail\"",
    );
    expect(emailPage).toContain(
      "const providerDisconnectLabel = `Disconnect ${provider.name} account ${provider.accountEmail ?? \"\"}`.trim()",
    );
    expect(emailPage).toContain(
      "const providerSyncActionLabel =",
    );
    expect(emailPage).toContain("const showDisconnect = shouldShowProviderDisconnect(provider)");
    expect(emailPage).toContain("`${providerSyncLabel}: import recent matched ${provider.name} messages`");
    expect(emailPage).toContain("`${providerSyncLabel}: store recent Gmail inbox threads`");
    expect(emailPage).toContain("import { ActionGroup }");
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={providerActionsLabel}>');
    expect(emailPage).toContain("aria-label={providerPrimaryActionLabel}");
    expect(emailPage).toContain("title={providerPrimaryActionLabel}");
    expect(emailPage).toContain("aria-label={providerSyncActionLabel}");
    expect(emailPage).toContain("title={providerSyncActionLabel}");
    expect(emailPage).toContain("aria-label={providerDisconnectLabel}");
    expect(emailPage).toContain("title={providerDisconnectLabel}");
    expect(emailPage).toContain("provider.syncAvailable");
    expect(emailPage).toContain("provider.disconnectAvailable");
    expect(emailPage).toContain("syncGmailInboxFromEmailPageAction");
    expect(emailPage).toContain("syncRecentMicrosoftFromEmailPageAction");
    expect(emailPage).toContain("disconnectEmailProviderFromEmailPageAction");
    expect(emailPage).toContain('value={provider.provider}');
    expect(emailPage).toContain("Disconnect");
    expect(emailPage).toContain("Sync Gmail inbox");
    expect(emailPage).toContain("Sync Google Workspace inbox");
    expect(emailPage).toContain("Sync recent Microsoft 365 mail");
    expect(emailPage).toContain("Sync recent Outlook mail");
    expect(emailPage).toContain("href={provider.href as Route}");
    expect(emailPage).toContain("Connected account: {provider.accountEmail}");
    expect(emailPage).toContain("Last sync: {formatDate(provider.lastSyncAt)}");
    expect(emailPage).toContain("Last sync issue: {provider.lastError}");
    expect(emailPage).toContain("Sync status: {provider.syncStatusLabel}");
    expect(emailPage).toContain("formatProviderSyncStatusDetail(provider.syncStatusDetail)");
    expect(emailConnectionService).toContain("syncStatusUpdatedAt?: Date | null");
    expect(emailConnectionService).toContain("syncStatusUpdatedAt: syncStatus.updatedAt");
    expect(emailPage).toContain("GmailSyncProgressPanel");
    expect(emailPage).toContain('aria-label="Gmail inbox sync progress"');
    expect(emailConnectionService).toContain("syncStatusLabel?: string | null");
    expect(emailConnectionService).toContain("syncStatusDetail?: string | null");
    expect(emailConnectionService).toContain("gmailSyncJobStatus(syncJob)");
    expect(emailConnectionService).toContain("Connect Gmail");
    expect(emailConnectionService).toContain("Reconnect Gmail");
    expect(emailConnectionService).toContain("Connect Microsoft");
    expect(emailConnectionService).toContain("Reconnect Microsoft");
    expect(emailConnectionService).toContain(
      'href: "/api/email-connections/microsoft/connect"',
    );
    expect(emailPage).toContain("return `Connect ${label}`");
    expect(emailPage).toContain("return `Reconnect ${label}`");
    expect(emailPage).toContain(
      "if (provider.syncAvailable) return `Reconnect ${label}`",
    );
    expect(emailPage).toContain("function shouldShowProviderDisconnect");
    expect(emailPage).toContain('provider.name === "Gmail"');
    expect(emailPage).toContain('provider.name === "Microsoft 365"');
    expect(emailPage).toContain(
      "Microsoft 365 uses the Microsoft Graph provider path.",
    );
    expect(emailPage).toContain(
      "Outlook uses the Microsoft 365 / Microsoft Graph provider path.",
    );
    expect(emailConnectionService).toContain(
      'syncAvailable: connection?.status === "CONNECTED"',
    );
    expect(emailConnectionService).toContain("Microsoft 365 / Outlook");
    expect(emailConnectionService).toContain("IMAP / SMTP");
    expect(emailConnectionService).toContain(
      "Add the Microsoft OAuth client id, client secret, redirect URI, and token encryption key",
    );
    expect(emailConnectionService).toContain("export async function disconnectEmailConnection");
    expect(emailConnectionService).toContain("emailConnectionSecret.deleteMany");
    expect(emailConnectionService).toContain('status: "DISCONNECTED"');
    expect(emailConnectionService).toContain("deletedAt: new Date()");
    expect(emailConnectionService).toContain("email_connection.disconnected");
    expect(emailConnectionService).toContain(
      "Planned fallback for Yahoo Mail, Zoho Mail, Fastmail, iCloud, custom domains, and hosting-provider email.",
    );
    expect(emailConnectionService).toContain("disabled: true");
    expect(emailConnectionService).not.toContain("Yahoo OAuth");
    expect(emailPage).not.toContain("Yahoo OAuth");
  });

  it("runs manual Gmail sync from the email page and reports matched, duplicate, and skipped counts", () => {
    expect(emailActions).toContain('"use server"');
    expect(emailActions).toContain("enqueueGmailInboxSyncJob(actor)");
    expect(emailActions).toContain("/email?emailConnection=gmail-sync-queued&syncStatus=1#gmail-sync-progress");
    expect(emailActions).toContain("syncOlderGmailInboxMessages({ actor, before })");
    expect(emailActions).toContain("refreshGmailInboxThread({ actor, threadId })");
    expect(emailActions).toContain("emailConnection: \"gmail-loaded-more\"");
    expect(emailActions).toContain("emailConnection: \"gmail-thread-refreshed\"");
    expect(emailActions).toContain(
      "syncRecentGmailMessages({ actor, maxResults: 10 })",
    );
    expect(emailActions).toContain("/email?emailConnection=gmail-synced");
    expect(emailActions).toContain("created=${result.created}");
    expect(emailActions).toContain("duplicates=${result.skippedDuplicates}");
    expect(emailActions).toContain("skipped=${result.skippedUnmatched}");
    expect(emailActions).toContain("total=${result.totalFetched}");
    expect(emailActions).toContain("setEmailSyncReviewCookie");
    expect(emailActions).toContain(
      "unmatchedPreviews: result.unmatchedPreviews",
    );
    expect(emailActions).toContain("/email?emailConnection=gmail-sync-error&syncStatus=1#gmail-sync-progress");
    expect(emailConnectionService).toContain(
      "normalizeRecentEmailSyncMaxResults(maxResults)",
    );
    expect(emailConnectionService).toContain("Number.isFinite(value)");
    expect(emailPage).toContain("Latest Sync Result");
    expect(emailPage).toContain("Fetched");
    expect(emailPage).toContain("Logged");
    expect(emailPage).toContain("Duplicates");
    expect(emailPage).toContain("Unmatched");
    expect(emailPage).toContain("StatCard");
    expect(emailPage).toContain(
      '<StatCard label="Fetched" value={syncSummary.totalFetched} />',
    );
    expect(emailPage).toContain(
      '<StatCard label="Unmatched" value={syncSummary.skipped} />',
    );
    expect(statCard).toContain('className="stat-card"');
    expect(emailPage).toContain(
      "stat-grid stat-grid-compact email-sync-metrics",
    );
    expect(emailPage).toContain('title="Sync scope"');
    expect(emailPage).toContain("email-status-callout email-sync-followup");
    expect(emailPage).toContain('title="Next step"');
    expect(globalCss).toContain(".email-sync-metrics");
    expect(globalCss).toContain(".email-sync-followup");
    expect(emailPage).not.toContain("style={{ marginBottom: 12 }}");
    expect(emailPage).not.toContain("style={{ marginTop: 8 }}");
    expect(emailPage).not.toContain("style={{ marginTop: 12 }}");
    expect(emailPage).toContain("Gmail Full Inbox sync finished.");
    expect(emailPage).toContain("Gmail inbox sync is queued.");
    expect(emailPage).toContain("gmailSyncProgressState");
    expect(emailPage).toContain('id="gmail-sync-progress"');
    expect(emailPage).toContain("Waiting to start Gmail sync");
    expect(emailPage).toContain("Syncing Gmail inbox");
    expect(emailPage).toContain("Gmail sync completed");
    expect(emailPage).toContain("Gmail sync completed with no stored messages");
    expect(emailPage).toContain("Refresh status");
    expect(emailPage).toContain("No Gmail account connected");
    expect(emailPage).toContain("Provider errors are redacted before they are shown here.");
    expect(globalCss).toContain(".gmail-sync-progress");
    expect(globalCss).toContain(".gmail-sync-progress-grid");
    expect(globalCss).toContain(".gmail-sync-progress-attention");
    expect(globalCss).toContain(".gmail-sync-progress-danger");
    expect(globalCss).toContain(".gmail-sync-progress-success");
    expect(emailPage).toContain("Older Gmail messages loaded.");
    expect(emailPage).toContain("Gmail thread refreshed.");
    expect(emailPage).toContain("skipped ${searchParams.skipped");
    expect(emailPage).toContain("duplicate");
    expect(emailPage).toContain("Gmail disconnected.");
    expect(emailPage).toContain("Encrypted OAuth tokens were removed");
    expect(emailPage).toContain("email-disconnect-error");
    expect(emailPage).toContain("fullInboxEmptyStateCopy(gmailProvider, inboxThreads.length)");
    expect(emailPage).toContain("EmailInboxEmptyShell");
    expect(emailPage).toContain("FullInboxHeaderActions");
    expect(emailPage).toContain("FullInboxPrimaryAction");
    expect(emailPage).toContain("Gmail is connected, but no inbox messages have synced yet");
    expect(emailPage).toContain("Gmail sync is queued");
    expect(emailPage).toContain("Gmail sync is running");
    expect(emailPage).toContain("Gmail sync needs attention");
    expect(emailPage).toContain("Sync Gmail inbox");
    expect(emailPage).toContain("Full Inbox mailbox reader");
    expect(emailPage).toContain("No synced threads");
    expect(emailPage).toContain("The mailbox reader stays here while sync catches up.");
  });

  it("renders command-center email cards with previews, attention badges, and linked CRM records", () => {
    expect(emailPage).toContain("Stored Email History");
    expect(emailPage).toContain("Suggested Follow-ups");
    expect(emailPage).toContain("EmailLogCard");
    expect(emailPage).toContain("emailNeedsAttention");
    expect(emailService).toContain("options: { limit?: number } = {}");
    expect(emailService).toContain("defaultEmailLogListLimit = 25");
    expect(emailService).toContain(
      "normalizeEmailLogListLimit(options.limit ?? defaultEmailLogListLimit)",
    );
    expect(emailService).toContain("Number.isFinite(limit)");
    expect(emailPage).toContain("emailLog.subject");
    expect(emailPage).toContain("title={emailLog.subject}");
    expect(emailPage).toContain("title={preview.subject}");
    expect(emailPage).toContain("description={");
    expect(emailPage).not.toContain("email-command-card-header");
    expect(emailPage).not.toContain("<h3>{emailLog.subject}</h3>");
    expect(emailPage).not.toContain("<h3>{preview.subject}</h3>");
    expect(globalCss).toContain(".email-command-card .panel-title-row");
    expect(globalCss).toContain(".email-command-card .compact-title");
    expect(globalCss).toContain(".email-inbox-thread-detail .email-inbox-thread-subject");
    expect(globalCss).toContain(".email-inbox-load-more");
    expect(globalCss).toContain(".email-inbox-empty-layout");
    expect(globalCss).toContain(".email-inbox-empty-rail");
    expect(globalCss).toContain(".email-inbox-empty-detail");
    expect(globalCss).toContain(".email-inbox-message-list .email-preview");
    expect(emailPage).toContain("Load older messages");
    expect(emailPage).toContain("Refresh thread");
    expect(emailPage).toContain("oldestInboxMessageDate(inboxThreads)");
    expect(globalCss).toContain(".email-draft-panel summary");
    expect(globalCss).toContain(".email-linked-follow-up-row > *");
    expect(globalCss).toContain(".email-linked-follow-up-title {\n    white-space: normal;");
    expect(globalCss).not.toContain(".email-command-card-header");
    expect(globalCss).not.toContain(".email-command-card h3");
    expect(emailPage).toContain("formatEmailProvider(emailLog.provider)");
    expect(emailPage).toContain(
      'if (provider === "GOOGLE_WORKSPACE") return "Gmail"',
    );
    expect(emailPage).toContain(
      'if (provider === "MICROSOFT_365") return "Microsoft"',
    );
    expect(emailPage).toContain(
      'emailLog.direction === "INBOUND" ? "From" : "To"',
    );
    expect(emailPage).toContain("emailLog.fromText");
    expect(emailPage).toContain("emailLog.toText");
    expect(emailPage).toContain("formatDate(emailLog.occurredAt)");
    expect(emailPage).toContain("formatEmailPreview(emailLog.body)");
    expect(emailPage).toContain(
      "const emailStatusLabel = `${emailLog.subject} email status`",
    );
    expect(emailPage).toContain(
      "const emailActionsLabel = `${emailLog.subject} email actions`",
    );
    expect(emailPage).toContain("const followUpDraft = buildEmailFollowUpDraftFromEmailLog(emailLog)");
    expect(emailPage).toContain("Relationship Inbox is the CRM action queue for stored email.");
    expect(emailPage).toContain("<EmailFollowUpPanel");
    expect(emailPage).toContain(
      "const createDealFromEmailLabel = `Create deal from email ${emailLog.subject}`",
    );
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={emailStatusLabel}>');
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={emailActionsLabel}>');
    expect(emailFollowUpPanel).toContain("Nothing is created until you save this follow-up.");
    expect(emailFollowUpPanel).toContain("Create activity");
    expect(emailPage).toContain("aria-label={createDealFromEmailLabel}");
    expect(emailPage).toContain("title={createDealFromEmailLabel}");
    expect(emailPage).toContain("Follow-up suggested");
    expect(emailPage).toContain("Needs follow-up");
    expect(emailPage).toContain("Deal communication");
    expect(emailPage).toContain("/contacts/${emailLog.person.id}");
    expect(emailPage).toContain("/organizations/${emailLog.organization.id}");
    expect(emailPage).toContain("/deals/${emailLog.deal.id}");
    expect(emailPage).toContain("/leads/${emailLog.lead.id}");
    expect(emailPage).toContain("No linked CRM record");
    expect(emailPage).toContain("InlineEmptyStateText");
    expect(emailPage).toContain(
      "<InlineEmptyStateText>No linked CRM record</InlineEmptyStateText>",
    );
    expect(emailPage).not.toContain(
      '<span className="muted">No linked CRM record</span>',
    );
    expect(globalCss).toContain(".relationship-inbox-evidence-excerpt");
    expect(globalCss).toContain(".relationship-inbox-evidence-chip");
    expect(globalCss).toContain(".relationship-inbox-action-detail > p");
    expect(globalCss).toContain(".relationship-inbox-next-action p");
    expect(globalCss).toContain("overflow-wrap: anywhere;");
    expect(inlineEmptyStateText).toContain("inline-empty-state-text");
    expect(emailPage).toContain("Create deal");
    expect(emailPage).toContain(
      "const createContactFromPreviewLabel = `Create contact from unmatched email ${preview.subject}`",
    );
    expect(emailPage).toContain(
      "const createLeadFromPreviewLabel = `Create lead from unmatched email ${preview.subject}`",
    );
    expect(emailPage).toContain("aria-label={createContactFromPreviewLabel}");
    expect(emailPage).toContain("title={createContactFromPreviewLabel}");
    expect(emailPage).toContain("aria-label={createLeadFromPreviewLabel}");
    expect(emailPage).toContain("title={createLeadFromPreviewLabel}");
    expect(emailPage).toContain(
      'const linkedRecordsLabel = "Linked CRM records"',
    );
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={linkedRecordsLabel}>');
    expect(emailPage).toContain('type: "contact"');
    expect(emailPage).toContain('type: "account"');
    expect(emailPage).toContain('type: "deal"');
    expect(emailPage).toContain('type: "lead"');
    expect(emailPage).toContain("const linkedRecordActionLabel = `Open linked ${link.type} ${link.label} from email ${emailLog.subject}`");
    expect(emailPage).toContain("aria-label={linkedRecordActionLabel}");
    expect(emailPage).toContain("title={linkedRecordActionLabel}");
  });

  it("shows temporary unmatched email review with create-contact/create-lead actions", () => {
    expect(emailPage).toContain("Unmatched Email Review");
    expect(emailPage).toContain(
      "Northstar is not storing unmatched inbox history.",
    );
    expect(emailPage).toContain("EmailPreviewCard");
    expect(emailPage).toContain("Possible new contact");
    expect(emailPage).toContain(
      "const previewStatusLabel = `${preview.subject} unmatched email status`",
    );
    expect(emailPage).toContain(
      "const previewActionsLabel = `${preview.subject} unmatched email actions`",
    );
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={previewStatusLabel}>');
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={previewActionsLabel}>');
    expect(emailPage).toContain("Create contact");
    expect(emailPage).toContain("Create lead");
    expect(emailPage).toContain("Ignore for now");
    expect(emailPage).toContain("buildContactHref");
    expect(emailPage).toContain("buildLeadHref");
    expect(emailPage).toContain("No matches yet");
  });

  it("keeps draft-only follow-up separate from explicit Gmail replies", () => {
    expect(emailPage).toContain("EmailDraftPanel");
    expect(emailDraftPanel).toContain(
      "Draft only. Northstar does not send this email or request send scopes.",
    );
    expect(emailDraftPanel).toContain("Copy draft");
    expect(emailDraftPanel).toContain("Open compose");
    expect(emailDraftPanel).toContain(
      'const draftDisclosureLabel = "Draft follow-up email"',
    );
    expect(emailDraftPanel).toContain("aria-label={draftDisclosureLabel}");
    expect(emailDraftPanel).toContain("title={draftDisclosureLabel}");
    expect(emailDraftPanel).toContain(
      "<summary title={draftDisclosureLabel}>Draft follow-up</summary>",
    );
    expect(emailDraftPanel).toContain(
      'const draftActionsLabel = "Email draft actions"',
    );
    expect(emailDraftPanel).toContain("import { ActionGroup }");
    expect(emailDraftPanel).toContain('<ActionGroup className="filter-actions" label={draftActionsLabel}>');
    expect(emailDraftPanel).toContain('title="Copy draft"');
    expect(emailDraftPanel).toContain('title="Open compose"');
    expect(emailDraftPanel).toContain("mailto:");
    expect(emailDraftPanel).toContain("fallbackTemplates");
    expect(emailDraftPanel).toContain("import { FormFieldLabel }");
    expect(emailDraftPanel).toContain(
      "<FormFieldLabel>Template</FormFieldLabel>",
    );
    expect(emailDraftPanel).toContain("<FormFieldLabel>To</FormFieldLabel>");
    expect(emailDraftPanel).toContain(
      "<FormFieldLabel>Subject</FormFieldLabel>",
    );
    expect(emailDraftPanel).toContain("<FormFieldLabel>Body</FormFieldLabel>");
    expect(emailDraftPanel).toContain("Following up on this");
    expect(emailDraftPanel).toContain("Checking in");
    expect(emailDraftPanel).toContain("Quote / proposal follow-up");
    expect(emailConnectionService).not.toContain("Mail.Send");
    expect(emailConnectionService).toContain("gmail.send");
    expect(emailPage).toContain("Explicit send only.");
    expect(emailPage).toContain("sendGmailReplyFromEmailPageAction");
  });

  it("keeps empty email state and record-page email cues clear", () => {
    expect(emailPage).toContain("EmptyState");
    expect(emailPage).toContain('title="No email activity yet"');
    expect(emailPage).not.toContain('<div className="empty-state">');
    expect(emailPage).toContain("No email activity yet");
    expect(emailPage).toContain(
      "Synced Gmail messages and reviewed manual fallback logs appear here.",
    );
    expect(emailPage).toContain("Gmail is connected, but no inbox messages have synced yet");
    expect(emailPage).toContain("Relationship Inbox and manual email logging still work without a synced mailbox.");
    expect(emailPage).toContain("Manual logging / legacy fallback");
    expect(emailPage).toContain("not available through synced Gmail Full Inbox yet");
    expect(emailPage).toContain("TODO: Remove or further de-emphasize manual logging after Gmail Full Inbox is proven in boss testing.");
    expect(globalCss).toContain(".manual-email-legacy-fallback");
    expect(manualEmailPanel).toContain("Log Manual Email");
    expect(manualEmailPanel).toContain("description={");
    expect(manualEmailPanel).not.toContain("panel-intro-copy");
    expect(manualEmailPanel).toContain("import { FormFieldLabel }");
    expect(manualEmailPanel).toContain(
      "<FormFieldLabel>Template</FormFieldLabel>",
    );
    expect(manualEmailPanel).toContain(
      "<FormFieldLabel required>Direction</FormFieldLabel>",
    );
    expect(manualEmailPanel).toContain(
      "<FormFieldLabel required>Email date</FormFieldLabel>",
    );
    expect(manualEmailPanel).toContain("<FormFieldLabel>From</FormFieldLabel>");
    expect(manualEmailPanel).toContain("<FormFieldLabel>To</FormFieldLabel>");
    expect(manualEmailPanel).toContain("<FormFieldLabel>Cc</FormFieldLabel>");
    expect(manualEmailPanel).toContain(
      "<FormFieldLabel required>Subject</FormFieldLabel>",
    );
    expect(manualEmailPanel).toContain(
      "<FormFieldLabel required>Body</FormFieldLabel>",
    );
    expect(manualEmailPanel).toContain('id = "email-log"');
    expect(manualEmailPanel).toContain("id={id}");
    expect(manualEmailPanel).toContain('href={"/email" as Route}');
    expect(manualEmailPanel).toContain(
      'const emailWorkspaceLabel = "Open Inbox to connect or sync email"',
    );
    expect(manualEmailPanel).toContain("aria-label={emailWorkspaceLabel}");
    expect(manualEmailPanel).toContain("title={emailWorkspaceLabel}");
    expect(manualEmailPanel).toContain(">\n              Inbox\n            </Link>");
    expect(manualEmailPanel).toContain(
      "sync recent matched messages from known contacts",
    );
  });

  it("keeps Settings as configuration for connections and templates", () => {
    expect(settingsPage).toContain('id="email-connections"');
    expect(settingsPage).toContain("<EmailTemplatesPanel");
    expect(emailTemplatesPanel).toContain(
      'className="panel section-separated"',
    );
    expect(emailTemplatesPanel).toContain("PanelTitleRow");
    expect(emailTemplatesPanel).toContain('title="Email Templates"');
    expect(emailTemplatesPanel).toContain("import { FormFieldLabel }");
    expect(emailTemplatesPanel).toContain(
      "<FormFieldLabel required>Name</FormFieldLabel>",
    );
    expect(emailTemplatesPanel).toContain(
      "<FormFieldLabel required>Subject</FormFieldLabel>",
    );
    expect(emailTemplatesPanel).toContain(
      "<FormFieldLabel required>Body</FormFieldLabel>",
    );
    expect(emailTemplatesPanel).toContain("CompactTitleRow");
    expect(emailTemplatesPanel).toContain("actions={");
    expect(emailTemplatesPanel).toContain(
      'import { Badge } from "@/components/badge"',
    );
    expect(emailTemplatesPanel).toContain(
      'actions={<Badge>{template.active ? "Active" : "Inactive"}</Badge>}',
    );
    expect(emailTemplatesPanel).toContain(
      'template.active ? "Active" : "Inactive"',
    );
    expect(emailTemplatesPanel).toContain("title={template.name}");
    expect(emailTemplatesPanel).not.toContain(
      '<h3 className="compact-title">{template.name}</h3>',
    );
    expect(emailTemplatesPanel).toContain("EmptyState");
    expect(emailTemplatesPanel).toContain('title="No email templates yet"');
    expect(emailTemplatesPanel).toContain("email-template-empty");
    expect(emailTemplatesPanel).not.toContain(
      '<p className="empty-copy">No email templates yet.</p>',
    );
    expect(compactTitleRow).toContain("export function CompactTitleRow");
    expect(compactTitleRow).toContain("import { useId, type ReactNode } from \"react\"");
    expect(compactTitleRow).toContain("titleId?: string");
    expect(compactTitleRow).toContain("const generatedTitleId = useId()");
    expect(compactTitleRow).toContain("const resolvedTitleId = titleId ?? `${generatedTitleId}-compact-title`");
    expect(compactTitleRow).toContain('<h3 className="compact-title" id={resolvedTitleId}>{title}</h3>');
    expect(emailTemplatesPanel).toContain("empty-copy section-separated");
    expect(emailTemplatesPanel).toContain('className="section-spaced"');
    expect(emailTemplatesPanel).not.toContain("style={{ marginBottom: 16 }}");
    expect(emailTemplatesPanel).not.toContain("style={{ marginTop: 18 }}");
    expect(settingsPage).toContain("Email Connections");
    expect(settingsPage).toContain("CompactTitleRow");
    expect(settingsPage).toContain(
      "actions={<Badge>{provider.status}</Badge>}",
    );
    expect(settingsPage).toContain('import { Badge } from "@/components/badge"');
    expect(settingsPage).toContain(
      "const providerPrimaryActionLabel = `${provider.actionLabel}: ${provider.name} provider setup`",
    );
    expect(settingsPage).toContain(
      "const providerSyncLabel = provider.syncLabel ?? \"Sync recent Gmail\"",
    );
    expect(settingsPage).toContain(
      "const providerSyncActionLabel = `${providerSyncLabel}: import recent matched ${provider.name} messages`",
    );
    expect(settingsPage).toContain("aria-label={providerPrimaryActionLabel}");
    expect(settingsPage).toContain("title={providerPrimaryActionLabel}");
    expect(settingsPage).toContain("aria-label={providerSyncActionLabel}");
    expect(settingsPage).toContain("title={providerSyncActionLabel}");
    expect(settingsPage).toContain("title={provider.name}");
    expect(settingsPage).not.toContain("<h3>{provider.name}</h3>");
    expect(emailPage).toContain('href="/settings#email-connections"');
    expect(emailPage).toContain("Email settings");
  });

  it("keeps provider cards resilient to long provider/account/status text", () => {
    expect(globalCss).toContain(
      "grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))",
    );
    expect(globalCss).toContain(".provider-card .badge");
    expect(globalCss).toContain("white-space: normal");
    expect(globalCss).toContain("overflow-wrap: anywhere");
    expect(globalCss).toContain(".provider-card .button-primary");
    expect(globalCss).toContain(".provider-card .button-secondary");
    expect(globalCss).toContain("word-break: break-word");
  });
});
