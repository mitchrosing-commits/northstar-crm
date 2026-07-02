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

  it("adds Email to the authenticated app navigation and protected-route guard", () => {
    expect(primaryNav).toContain("Inbox");
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(navigation).toContain('href: "/email"');
    expect(navigation).toContain('label: "Email"');
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
      "Review provider status, sync results, and CRM-linked email activity.",
    );
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
    expect(emailPage).toContain('title="Synced Emails"');
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
    expect(emailPage).toContain('title="No email connected yet"');
    expect(emailPage).toContain('className="email-provider-empty"');
    expect(emailPage).not.toContain(
      '<div className="empty-state email-provider-empty">',
    );
    expect(emailPage).toContain('className="data-card section-separated"');
    expect(emailPage).toContain(
      "Northstar syncs recent email metadata/snippets from connected providers",
    );
    expect(emailPage).toContain("does not import");
    expect(emailPage).toContain("full inboxes");
    expect(emailPage).toContain("attachments");
    expect(emailPage).toContain("full message bodies");
    expect(emailPage).toContain("send email yet");
    expect(emailPage).toContain("Unmatched");
    expect(emailPage).toContain("messages are skipped.");
    expect(emailPage).toContain("majorProviderCards.map");
    expect(emailPage).toContain("provider.name");
    expect(emailPage).toContain(
      'actions={<span className="badge">{provider.status}</span>}',
    );
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
      "const providerSyncActionLabel = `${providerSyncLabel}: import recent matched ${provider.name} messages`",
    );
    expect(emailPage).toContain("import { ActionGroup }");
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={providerActionsLabel}>');
    expect(emailPage).toContain("aria-label={providerPrimaryActionLabel}");
    expect(emailPage).toContain("title={providerPrimaryActionLabel}");
    expect(emailPage).toContain("aria-label={providerSyncActionLabel}");
    expect(emailPage).toContain("title={providerSyncActionLabel}");
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
    expect(emailPage).toContain("Last sync issue: {provider.lastError}");
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
    expect(emailConnectionService).toContain(
      "Planned fallback for Yahoo Mail, Zoho Mail, Fastmail, iCloud, custom domains, and hosting-provider email.",
    );
    expect(emailConnectionService).toContain("disabled: true");
    expect(emailConnectionService).not.toContain("Yahoo OAuth");
    expect(emailPage).not.toContain("Yahoo OAuth");
  });

  it("runs manual Gmail sync from the email page and reports matched, duplicate, and skipped counts", () => {
    expect(emailActions).toContain('"use server"');
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
    expect(emailActions).toContain("/email?emailConnection=gmail-sync-error");
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
    expect(emailPage).toContain(
      "const addFollowUpLabel = `Add follow-up for email ${emailLog.subject}`",
    );
    expect(emailPage).toContain(
      "const createDealFromEmailLabel = `Create deal from email ${emailLog.subject}`",
    );
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={emailStatusLabel}>');
    expect(emailPage).toContain('<ActionGroup className="filter-actions" label={emailActionsLabel}>');
    expect(emailPage).toContain("aria-label={addFollowUpLabel}");
    expect(emailPage).toContain("title={addFollowUpLabel}");
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

  it("adds follow-up drafting without send scopes or provider sending", () => {
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
    expect(emailConnectionService).not.toContain("gmail.send");
  });

  it("keeps empty email state and record-page email cues clear", () => {
    expect(emailPage).toContain("EmptyState");
    expect(emailPage).toContain('title="No email activity yet"');
    expect(emailPage).not.toContain('<div className="empty-state">');
    expect(emailPage).toContain("No email activity yet");
    expect(emailPage).toContain(
      "Log an email manually from a deal, contact, organization, or lead.",
    );
    expect(emailPage).toContain("After Gmail is connected");
    expect(emailPage).toContain("Connect Gmail / Google Workspace");
    expect(emailPage).toContain("Log an email manually");
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
      'const emailWorkspaceLabel = "Open Email workspace to connect or sync email"',
    );
    expect(manualEmailPanel).toContain("aria-label={emailWorkspaceLabel}");
    expect(manualEmailPanel).toContain("title={emailWorkspaceLabel}");
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
    expect(emailTemplatesPanel).toContain('className="badge"');
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
      'actions={<span className="badge">{provider.status}</span>}',
    );
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
