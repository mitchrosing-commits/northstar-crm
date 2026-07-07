import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const route = readFileSync(
  join(
    process.cwd(),
    "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts",
  ),
  "utf8",
);
const validators = readFileSync(
  join(process.cwd(), "lib/validators/crm.ts"),
  "utf8",
);
const emailService = readFileSync(
  join(process.cwd(), "lib/services/email-service.ts"),
  "utf8",
);
const recordGuards = readFileSync(
  join(process.cwd(), "lib/services/record-guards.ts"),
  "utf8",
);
const timelineService = readFileSync(
  join(process.cwd(), "lib/services/timeline-service.ts"),
  "utf8",
);
const recordTimeline = readFileSync(
  join(process.cwd(), "components/record-timeline.tsx"),
  "utf8",
);
const manualEmailPanel = readFileSync(
  join(process.cwd(), "components/manual-email-log-panel.tsx"),
  "utf8",
);
const panelTitleRow = readFileSync(
  join(process.cwd(), "components/panel-title-row.tsx"),
  "utf8",
);
const recordPanelJumpNav = readFileSync(
  join(process.cwd(), "components/record-panel-jump-nav.tsx"),
  "utf8",
);
const settingsPage = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);
const emailConnectionService = readFileSync(
  join(process.cwd(), "lib/services/email-connection-service.ts"),
  "utf8",
);
const emailTemplatesPanel = readFileSync(
  join(process.cwd(), "app/settings/email-templates-panel.tsx"),
  "utf8",
);
const dealPage = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/page.tsx"),
  "utf8",
);
const contactPage = readFileSync(
  join(process.cwd(), "app/contacts/[personId]/page.tsx"),
  "utf8",
);
const organizationPage = readFileSync(
  join(process.cwd(), "app/organizations/[organizationId]/page.tsx"),
  "utf8",
);
const leadPage = readFileSync(
  join(process.cwd(), "app/leads/[leadId]/page.tsx"),
  "utf8",
);
const currentStatus = readFileSync(
  join(process.cwd(), "docs/current-status.md"),
  "utf8",
);
const architecture = readFileSync(
  join(process.cwd(), "docs/architecture.md"),
  "utf8",
);
const routeMap = readFileSync(
  join(process.cwd(), "docs/api-route-map.md"),
  "utf8",
);

describe("manual email logging and templates foundation", () => {
  it("adds workspace-scoped email log and template models without plaintext provider tokens", () => {
    expect(schema).toContain("model EmailLog");
    expect(schema).toContain("model EmailLogActivityLink");
    expect(schema).toContain("model EmailTemplate");
    expect(schema).toContain("enum EmailDirection");
    expect(schema).toContain("INBOUND");
    expect(schema).toContain("OUTBOUND");
    expect(schema).toContain("createdBy      User?");
    expect(schema).toMatch(/emailLogs\s+EmailLog\[\]/);
    expect(schema).toMatch(/emailLogActivityLinks\s+EmailLogActivityLink\[\]/);
    expect(schema).toMatch(/emailTemplates\s+EmailTemplate\[\]/);
    expect(schema).not.toMatch(/\n\s+accessToken\s+String/);
    expect(schema).not.toMatch(/\n\s+refreshToken\s+String/);
  });

  it("routes manual email logs and templates through validated workspace APIs", () => {
    expect(route).toContain('resource === "email-logs"');
    expect(route).toContain("createEmailLog(actor, createEmailLogSchema.parse");
    expect(route).toContain("listEmailLogs(actor)");
    expect(route).toContain('resource === "email-templates"');
    expect(route).toContain(
      "createEmailTemplate(actor, createEmailTemplateSchema.parse",
    );
    expect(route).toContain(
      "updateEmailTemplate(actor, idOrNested, updateEmailTemplateSchema.parse",
    );
    expect(route).toContain("setEmailTemplateActive(actor, idOrNested, false)");
    expect(route).toContain("setEmailTemplateActive(actor, idOrNested, true)");
    expect(validators).toContain("createEmailLogSchema");
    expect(validators).toContain('direction: z.enum(["INBOUND", "OUTBOUND"])');
    expect(validators).toContain("occurredAt: requiredDate");
    expect(validators).toContain("createEmailTemplateSchema");
    expect(validators).toContain(
      "updateEmailTemplateSchema = createEmailTemplateSchema.partial()",
    );
  });

  it("keeps email logging workspace-scoped, audited, and manual-only", () => {
    expect(emailService).toContain("export async function createEmailLog");
    expect(emailService).toContain(
      "export async function listEmailLogsForRecord",
    );
    expect(emailService).toContain("normalizeEmailLogRecordType(record.type)");
    expect(emailService).toContain(
      "Email log record type must be DEAL, LEAD, PERSON, or ORGANIZATION.",
    );
    expect(emailService).toContain("normalizeEmailTemplateActiveFlag(active)");
    expect(emailService).toContain(
      "normalizeEmailTemplateActiveOnlyFilter(options.activeOnly)",
    );
    expect(emailService).toContain(
      "Email template active flag must be true or false.",
    );
    expect(emailService).toContain(
      "Email template active-only filter must be true or false.",
    );
    expect(emailService).toContain(
      "if (existing.active === activeFlag) return existing;",
    );
    expect(emailService).toContain("Email template update must be an object.");
    expect(emailService).toContain("Array.isArray(data)");
    expect(emailService).toContain(
      "Object.keys(normalized).length === 0 || !emailTemplateUpdateChanges(normalized, existing)",
    );
    expect(emailService).toContain("emailTemplateUpdateChanges(");
    expect(emailService).toContain("const input = objectInput(data)");
    expect(emailService).toContain(
      'normalizeRequiredEmailText(input.subject, "Email subject is required.")',
    );
    expect(emailService).toContain(
      'normalizeRequiredEmailText(input.body, "Template body is required.")',
    );
    expect(emailService).toContain("normalizeEmailAttachmentId(input.dealId)");
    expect(emailService).toContain("Email log attachment ids must be text.");
    expect(emailService).toContain(
      "normalizeOptionalEmailParticipantText(input.fromText)",
    );
    expect(emailService).toContain("Email participant fields must be text.");
    expect(emailService).toContain("normalizeEmailProvider(input.provider)");
    expect(emailService).toContain(
      "Email provider must be Google Workspace, Microsoft 365, or IMAP/SMTP.",
    );
    expect(emailService).toContain(
      "assertEmailLogLinks(actor.workspaceId, normalized)",
    );
    expect(emailService).toContain('writeAuditLog(actor, "email_log.created"');
    expect(recordGuards).toContain("export async function assertEmailLogLinks");
    expect(recordGuards).toContain("assertOpenDealInWorkspace");
    expect(recordGuards).toContain("Closed deals cannot be edited.");
    expect(recordGuards).toContain("Attach the email log to a CRM record.");
    expect(recordGuards).toContain("Log email context on the converted deal.");
    expect(emailService).not.toContain("fetch(");
    expect(emailService).not.toContain("sendMail");
    expect(emailService).not.toContain("smtp");
  });

  it("adds manual email logging UI to core detail pages with template prefill", () => {
    for (const page of [dealPage, contactPage, organizationPage, leadPage]) {
      expect(page).toContain("ManualEmailLogPanel");
      expect(page).toContain("listEmailTemplates(actor, { activeOnly: true })");
    }
    expect(dealPage).toContain(
      'lockedMessage={closedDealLockMessage("emailLogs")}',
    );
    expect(dealPage).toContain('showForm={deal.status === "OPEN"}');
    expect(leadPage).toContain(
      'lockedMessage={convertedLeadLockMessage("emailLogs")}',
    );
    expect(leadPage).toContain('showForm={lead.status !== "CONVERTED"}');
    expect(manualEmailPanel).toContain(
      "/api/v1/workspaces/${workspaceId}/email-logs",
    );
    expect(manualEmailPanel).toContain("Log Manual Email");
    expect(manualEmailPanel).toContain("PanelTitleRow");
    expect(manualEmailPanel).toContain(
      "actions={<Badge>Manual</Badge>}",
    );
    expect(manualEmailPanel).toContain('import { Badge } from "@/components/badge"');
    expect(manualEmailPanel).toContain("description={");
    expect(manualEmailPanel).toContain('title="Log Manual Email"');
    expect(manualEmailPanel).not.toContain("panel-intro-copy");
    expect(panelTitleRow).toContain("export function PanelTitleRow");
    expect(panelTitleRow).toContain("description?: ReactNode");
    expect(manualEmailPanel).toContain('id = "email-log"');
    expect(manualEmailPanel).toContain("id={id}");
    expect(manualEmailPanel).toContain("already sent or received");
    expect(manualEmailPanel).toContain("This does not send email, sync an");
    expect(manualEmailPanel).toContain("inbox, or create background jobs.");
    expect(manualEmailPanel).toContain(
      'const emailWorkspaceLabel = "Open Inbox to connect or sync email"',
    );
    expect(manualEmailPanel).toContain("aria-label={emailWorkspaceLabel}");
    expect(manualEmailPanel).toContain("title={emailWorkspaceLabel}");
    expect(manualEmailPanel).toContain(">\n              Inbox\n            </Link>");
    expect(manualEmailPanel).toContain("Outbound - already sent");
    expect(manualEmailPanel).toContain("Inbound - received");
    expect(manualEmailPanel).toContain(
      "Templates fill only the subject and body.",
    );
    expect(manualEmailPanel).toContain("Email date");
    expect(manualEmailPanel).toContain("Save email log");
    expect(manualEmailPanel).toContain("FormActionBar");
    expect(manualEmailPanel).toContain('pendingLabel="Saving log..."');
    expect(manualEmailPanel).toContain(
      'disabledHint="Add a subject and body before saving this email log."',
    );
    expect(manualEmailPanel).toContain(
      "submitDisabled={!subject.trim() || !body.trim()}",
    );
    expect(manualEmailPanel).toContain('submitLabel="Save email log"');
    expect(manualEmailPanel).toContain(
      "const activeTemplates = templates.filter((template) => template.active !== false)",
    );
    expect(manualEmailPanel).toContain("applyTemplate");
    expect(manualEmailPanel).toContain(
      "activeTemplates.find((item) => item.id === templateId)",
    );
    expect(manualEmailPanel).toContain("setSubject(template.subject)");
    expect(manualEmailPanel).toContain("setBody(template.body)");
    expect(recordPanelJumpNav).toContain('href: "#email-log" as Route');
    expect(recordPanelJumpNav).toContain("Email");
  });

  it("surfaces manual email logs in the shared record timeline", () => {
    expect(timelineService).toContain("prisma.emailLog.findMany");
    expect(timelineService).toContain('type: "email" as const');
    expect(timelineService).toContain("timestamp: emailLog.occurredAt");
    expect(recordTimeline).toContain(
      "formatEmailTimelineLabel(item.direction)",
    );
    expect(recordTimeline).toContain("Logged inbound email");
    expect(recordTimeline).toContain("Logged outbound email");
    expect(recordTimeline).toContain("<TimelineMetaRow");
    expect(recordTimeline).toContain("formatActivityType(item.activityType)");
    expect(recordTimeline).toContain("formatEmailParticipant(item.fromText)");
    expect(recordTimeline).toContain("Not recorded");
    expect(recordTimeline).toContain("formatEmailPreview(item.body)");
    expect(recordTimeline).toContain("`Logged by ${item.createdByName}`");
  });

  it("adds settings-based email template management without sending or merge variables", () => {
    expect(settingsPage).toContain("<EmailTemplatesPanel");
    expect(settingsPage).toContain("listEmailTemplates(actor)");
    expect(emailTemplatesPanel).toContain(
      "/api/v1/workspaces/${workspaceId}/email-templates",
    );
    expect(emailTemplatesPanel).toContain(
      "/email-templates/${template.id}/${action}",
    );
    expect(emailTemplatesPanel).toContain(
      "Reusable text for manual email logs.",
    );
    expect(emailTemplatesPanel).toContain("Templates do not send email");
    expect(emailTemplatesPanel).toContain("merge variables");
    expect(emailTemplatesPanel).toContain("EmptyState");
    expect(emailTemplatesPanel).toContain('title="No email templates yet"');
    expect(emailTemplatesPanel).toContain("Deactivate");
    expect(emailTemplatesPanel).toContain("Reactivate");
  });

  it("shows honest email connection status without fake-live providers", () => {
    expect(settingsPage).toContain("function EmailConnectionsPanel");
    expect(settingsPage).toContain("providers={emailProviderCards}");
    expect(settingsPage).toContain(
      "status={resolvedSearchParams?.emailConnection}",
    );
    expect(settingsPage).toContain("listEmailConnectionProviderCards(actor)");
    expect(settingsPage).toContain("providers.map");
    expect(settingsPage).toContain("provider.name");
    expect(emailConnectionService).toContain("Gmail / Google Workspace");
    expect(emailConnectionService).toContain("Microsoft 365 / Outlook");
    expect(emailConnectionService).toContain("IMAP / SMTP");
    expect(settingsPage).toContain("Manual logging available");
    expect(settingsPage).toContain("Password reset delivery runs through");
    expect(settingsPage).toContain("background job queue");
    expect(settingsPage).toContain("Gmail / Google Workspace and Microsoft");
    expect(settingsPage).toContain("365 / Outlook can connect");
    expect(settingsPage).toContain(
      "can connect when OAuth env and encrypted token",
    );
    expect(settingsPage).toContain("Manual sync imports recent matched");
    expect(settingsPage).toContain("metadata/snippets from");
    expect(settingsPage).toContain("known contacts only.");
    expect(settingsPage).toContain("Sync recent Gmail");
    expect(settingsPage).toContain("disabled");
    expect(settingsPage).toContain('type="button"');
    expect(settingsPage).toContain("provider.actionLabel");
    expect(settingsPage).toContain(
      "Connected account: {provider.accountEmail}",
    );
    expect(settingsPage).toContain(
      "Last sync: {formatDate(provider.lastSyncAt)}",
    );
    expect(settingsPage).toContain("Last sync issue: {provider.lastError}");
    expect(settingsPage).not.toContain("Connect Gmail");
    expect(settingsPage).not.toContain("Connect Outlook");
  });

  it("documents the manual logging and provider inbox boundaries", () => {
    expect(currentStatus).toContain("Manual email logs can be created");
    expect(currentStatus).toContain("Gmail Full Inbox v1 uses the background job worker");
    expect(currentStatus).toContain("connecting/reconnecting Gmail enqueues an `email.gmail_sync` job");
    expect(currentStatus).toContain(
      "Clicking `/email` Sync Gmail inbox enqueues and immediately claims one bounded Gmail sync job through the same job record"
    );
    expect(currentStatus).toContain("Unattended reconnect/background jobs still require `npm run jobs:work`");
    expect(currentStatus).toContain("The `/email` Load older messages action uses a user-triggered bounded Gmail `before:` inbox search");
    expect(currentStatus).toContain("neither path mutates the stored history cursor");
    expect(currentStatus).toContain("never stores OAuth tokens or message bodies in job payloads");
    expect(currentStatus).toContain("Microsoft/Outlook whole-mailbox or background sync");
    expect(currentStatus).toContain("Gmail Full Inbox requires Gmail read/send scopes");
    expect(architecture).toContain(
      "Manual email logs are workspace-scoped plain-text records",
    );
    expect(architecture).toContain("Gmail Full Inbox sync runs through the explicit `email.gmail_sync` job handler");
    expect(architecture).toContain(
      "The `/email` Sync Gmail inbox action enqueues and immediately claims the selected connection's Gmail sync job"
    );
    expect(architecture).toContain("Provider-card sync status is looked up by the selected Gmail connection's dedupe key");
    expect(architecture).toContain("selected-thread refresh calls Gmail thread detail for a provider thread id that already has a same-workspace `EmailLog`");
    expect(architecture).toContain("deliberately leave `lastSyncCursor` unchanged");
    expect(architecture).toContain("Explicit Gmail replies use the connected account and Gmail `messages.send`");
    expect(routeMap).toContain("Gmail Full Inbox sync, older-message load-more, selected-thread refresh, and explicit Gmail reply actions");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/email-logs");
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/email-templates",
    );
  });
});
