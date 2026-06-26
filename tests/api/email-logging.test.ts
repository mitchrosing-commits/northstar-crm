import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const route = readFileSync(join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"), "utf8");
const validators = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const emailService = readFileSync(join(process.cwd(), "lib/services/email-service.ts"), "utf8");
const recordGuards = readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8");
const timelineService = readFileSync(join(process.cwd(), "lib/services/timeline-service.ts"), "utf8");
const recordTimeline = readFileSync(join(process.cwd(), "components/record-timeline.tsx"), "utf8");
const manualEmailPanel = readFileSync(join(process.cwd(), "components/manual-email-log-panel.tsx"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const emailConnectionService = readFileSync(join(process.cwd(), "lib/services/email-connection-service.ts"), "utf8");
const emailTemplatesPanel = readFileSync(join(process.cwd(), "app/settings/email-templates-panel.tsx"), "utf8");
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");

describe("manual email logging and templates foundation", () => {
  it("adds workspace-scoped email log and template models without plaintext provider tokens", () => {
    expect(schema).toContain("model EmailLog");
    expect(schema).toContain("model EmailTemplate");
    expect(schema).toContain("enum EmailDirection");
    expect(schema).toContain("INBOUND");
    expect(schema).toContain("OUTBOUND");
    expect(schema).toContain("createdBy      User?");
    expect(schema).toContain("emailLogs       EmailLog[]");
    expect(schema).toMatch(/emailTemplates\s+EmailTemplate\[\]/);
    expect(schema).not.toMatch(/\n\s+accessToken\s+String/);
    expect(schema).not.toMatch(/\n\s+refreshToken\s+String/);
  });

  it("routes manual email logs and templates through validated workspace APIs", () => {
    expect(route).toContain("resource === \"email-logs\"");
    expect(route).toContain("createEmailLog(actor, createEmailLogSchema.parse");
    expect(route).toContain("listEmailLogs(actor)");
    expect(route).toContain("resource === \"email-templates\"");
    expect(route).toContain("createEmailTemplate(actor, createEmailTemplateSchema.parse");
    expect(route).toContain("updateEmailTemplate(actor, idOrNested, updateEmailTemplateSchema.parse");
    expect(route).toContain("setEmailTemplateActive(actor, idOrNested, false)");
    expect(route).toContain("setEmailTemplateActive(actor, idOrNested, true)");
    expect(validators).toContain("createEmailLogSchema");
    expect(validators).toContain("direction: z.enum([\"INBOUND\", \"OUTBOUND\"])");
    expect(validators).toContain("occurredAt: requiredDate");
    expect(validators).toContain("createEmailTemplateSchema");
  });

  it("keeps email logging workspace-scoped, audited, and manual-only", () => {
    expect(emailService).toContain("export async function createEmailLog");
    expect(emailService).toContain("export async function listEmailLogsForRecord");
    expect(emailService).toContain("assertEmailLogLinks(actor.workspaceId, normalized)");
    expect(emailService).toContain("writeAuditLog(actor, \"email_log.created\"");
    expect(recordGuards).toContain("export async function assertEmailLogLinks");
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
    expect(leadPage).toContain("Log new email context on the converted deal.");
    expect(leadPage).toContain("showForm={lead.status !== \"CONVERTED\"}");
    expect(manualEmailPanel).toContain("/api/v1/workspaces/${workspaceId}/email-logs");
    expect(manualEmailPanel).toContain("Log Manual Email");
    expect(manualEmailPanel).toContain("already sent or received");
    expect(manualEmailPanel).toContain("This does not send email, sync an");
    expect(manualEmailPanel).toContain("inbox, or create background jobs.");
    expect(manualEmailPanel).toContain("Outbound - already sent");
    expect(manualEmailPanel).toContain("Inbound - received");
    expect(manualEmailPanel).toContain("Templates fill only the subject and body.");
    expect(manualEmailPanel).toContain("Email date");
    expect(manualEmailPanel).toContain("Save email log");
    expect(manualEmailPanel).toContain("const activeTemplates = templates.filter((template) => template.active !== false)");
    expect(manualEmailPanel).toContain("applyTemplate");
    expect(manualEmailPanel).toContain("activeTemplates.find((item) => item.id === templateId)");
    expect(manualEmailPanel).toContain("setSubject(template.subject)");
    expect(manualEmailPanel).toContain("setBody(template.body)");
  });

  it("surfaces manual email logs in the shared record timeline", () => {
    expect(timelineService).toContain("prisma.emailLog.findMany");
    expect(timelineService).toContain("type: \"email\" as const");
    expect(timelineService).toContain("timestamp: emailLog.occurredAt");
    expect(recordTimeline).toContain("formatEmailTimelineLabel(item.direction)");
    expect(recordTimeline).toContain("Logged inbound email");
    expect(recordTimeline).toContain("Logged outbound email");
    expect(recordTimeline).toContain("Activity · {formatActivityType(item.activityType)}");
    expect(recordTimeline).toContain("formatEmailParticipant(item.fromText)");
    expect(recordTimeline).toContain("Not recorded");
    expect(recordTimeline).toContain("formatEmailPreview(item.body)");
    expect(recordTimeline).toContain("Logged by {item.createdByName}");
  });

  it("adds settings-based email template management without sending or merge variables", () => {
    expect(settingsPage).toContain("<EmailTemplatesPanel");
    expect(settingsPage).toContain("listEmailTemplates(actor)");
    expect(emailTemplatesPanel).toContain("/api/v1/workspaces/${workspaceId}/email-templates");
    expect(emailTemplatesPanel).toContain("/email-templates/${template.id}/${action}");
    expect(emailTemplatesPanel).toContain("Reusable text for manual email logs.");
    expect(emailTemplatesPanel).toContain("Templates do not send email");
    expect(emailTemplatesPanel).toContain("merge variables");
    expect(emailTemplatesPanel).toContain("Deactivate");
    expect(emailTemplatesPanel).toContain("Reactivate");
  });

  it("shows honest email connection status without fake-live providers", () => {
    expect(settingsPage).toContain("function EmailConnectionsPanel");
    expect(settingsPage).toContain("providers={emailProviderCards}");
    expect(settingsPage).toContain("status={resolvedSearchParams?.emailConnection}");
    expect(settingsPage).toContain("listEmailConnectionProviderCards(actor)");
    expect(settingsPage).toContain("providers.map");
    expect(settingsPage).toContain("provider.name");
    expect(emailConnectionService).toContain("Gmail / Google Workspace");
    expect(emailConnectionService).toContain("Microsoft 365 / Outlook");
    expect(emailConnectionService).toContain("IMAP / SMTP");
    expect(settingsPage).toContain("Manual logging available");
    expect(settingsPage).toContain("Password reset delivery runs through");
    expect(settingsPage).toContain("background job queue");
    expect(settingsPage).toContain("Gmail can connect when OAuth env and encrypted token");
    expect(settingsPage).toContain("Manual sync imports recent matched messages from known contacts only.");
    expect(settingsPage).toContain("Sync recent Gmail");
    expect(settingsPage).toContain("disabled type=\"button\"");
    expect(settingsPage).toContain("provider.actionLabel");
    expect(settingsPage).not.toContain("Connect Gmail");
    expect(settingsPage).not.toContain("Connect Outlook");
  });

  it("documents the manual-only email boundary", () => {
    expect(currentStatus).toContain("Manual email logs can be created");
    expect(currentStatus).toContain("Gmail/Outlook background sync");
    expect(currentStatus).toContain("manual recent Gmail metadata sync action");
    expect(architecture).toContain("Manual email logs are workspace-scoped plain-text records");
    expect(architecture).toContain("do not send email");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/email-logs");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/email-templates");
  });
});
