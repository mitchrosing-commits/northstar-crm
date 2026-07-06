import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { ActionGroup } from "@/components/action-group";
import { ActivityCompleteButton } from "@/components/activity-complete-button";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { EmptyState } from "@/components/empty-state";
import { EmailAiReplyPanel } from "@/components/email-ai-reply-panel";
import { EmailDraftPanel } from "@/components/email-draft-panel";
import { EmailFollowUpPanel } from "@/components/email-follow-up-panel";
import { EmailSmartLabelPanel } from "@/components/email-smart-label-panel";
import { formatDate } from "@/components/format";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatCard } from "@/components/stat-card";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import {
  buildEmailPriorityQueue,
  buildEmailPriorityQueueSummary,
  buildEmailFollowUpDraftFromEmailLog,
  emailClassificationReadiness,
  emailFollowUpStateLabel,
  emailReplyAssistantReadiness,
  listEmailConnectionProviderCards,
  listEmailPriorityFollowUpDetails,
  listEmailLogs,
  listEmailTemplates,
  normalizeEmailPriorityQueueFilter,
  readEmailSmartClassification
} from "@/lib/services/crm";
import type { EmailClassificationReadiness } from "@/lib/services/email-classification-service";
import type {
  EmailLinkedFollowUpSummary,
  EmailPriorityFollowUpDetail,
  EmailPriorityNextBestAction,
  EmailPriorityQueueExplainer,
  EmailPriorityQueueEvidenceTrailItem
} from "@/lib/services/email-priority-queue-service";
import type { EmailReplyAssistantReadiness } from "@/lib/services/email-reply-assistant-service";
import type { EmailSyncPreview } from "@/lib/services/email-connection-service";
import { syncRecentGmailFromEmailPageAction, syncRecentMicrosoftFromEmailPageAction } from "./actions";
import { decodeEmailSyncReview, emailSyncReviewCookieName } from "./sync-review";

export const dynamic = "force-dynamic";

type EmailPageProps = {
  searchParams?: Promise<{
    created?: string;
    duplicates?: string;
    emailConnection?: string;
    inbox?: string;
    skipped?: string;
    total?: string;
  }>;
};

export default async function EmailPage({ searchParams }: EmailPageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const cookieStore = await cookies();
  const latestSyncReview = isSyncResult(resolvedSearchParams?.emailConnection)
    ? decodeEmailSyncReview(cookieStore.get(emailSyncReviewCookieName)?.value)
    : null;
  const [providers, recentEmailLogs, emailTemplates] = await Promise.all([
    listEmailConnectionProviderCards(actor),
    listEmailLogs(actor, { limit: 25 }),
    listEmailTemplates(actor, { activeOnly: true })
  ]);
  const followUpDetails = await listEmailPriorityFollowUpDetails(actor, recentEmailLogs);
  const gmailProvider = providers.find((provider) => provider.provider === "GOOGLE_WORKSPACE");
  const microsoftProvider = providers.find((provider) => provider.provider === "MICROSOFT_365");
  const imapProvider = providers.find((provider) => provider.provider === "IMAP_SMTP");
  const majorProviderCards = buildMajorProviderCards({ gmailProvider, microsoftProvider });
  const statusCopy = emailStatusCopy(resolvedSearchParams);
  const syncSummary = buildSyncSummary(resolvedSearchParams, latestSyncReview, majorProviderCards);
  const aiReplyReadiness = emailReplyAssistantReadiness(process.env);
  const smartLabelReadiness = emailClassificationReadiness(process.env);
  const draftTemplates = emailTemplates.map((template) => ({
    body: template.body,
    id: template.id,
    name: template.name,
    subject: template.subject
  }));
  const attentionLogs = recentEmailLogs.filter((emailLog) => emailNeedsAttention(emailLog)).slice(0, 6);
  const activeInboxFilter = normalizeEmailPriorityQueueFilter(resolvedSearchParams?.inbox);
  const priorityQueueSummary = buildEmailPriorityQueueSummary(recentEmailLogs);
  const allPriorityQueueItems = buildEmailPriorityQueue({
    emailLogs: recentEmailLogs,
    followUpDetails
  });
  const priorityQueueItems = buildEmailPriorityQueue({
    emailLogs: recentEmailLogs,
    filter: activeInboxFilter,
    followUpDetails
  });
  const priorityExplainersByEmailId = new Map(allPriorityQueueItems.map((item) => [item.emailLog.id, item.explainer]));
  const activeInboxFilterLabel = priorityQueueSummary.find((item) => item.id === activeInboxFilter)?.label ?? "All priority";
  const emailSettingsLabel = "Open email connection settings";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link
            aria-label={emailSettingsLabel}
            className="button-secondary"
            href="/settings#email-connections"
            title={emailSettingsLabel}
          >
            Email settings
          </Link>
        }
        eyebrow="Communication"
        subtitle="Review provider status, sync results, and CRM-linked email activity."
        title="Email"
      />

      <section className="panel section-separated">
        <PanelTitleRow actions={<Badge>{gmailProvider?.status ?? "Not configured"}</Badge>} title="Email Providers" />
        <EmailScopeCallout title="Sync boundaries">
          Northstar syncs recent email metadata/snippets from connected providers and logs matched emails to known
          contacts. It does not import full inboxes, attachments, full message bodies, or send email yet. Unmatched
          messages are skipped.
        </EmailScopeCallout>
        {!gmailProvider?.syncAvailable ? (
          <EmptyState
            className="email-provider-empty"
            description="Connect Gmail / Google Workspace when OAuth is configured, or keep logging email manually from CRM records."
            title="No email connected yet"
          />
        ) : null}
        {statusCopy ? (
          <FormIntroCallout className="email-status-callout" title="Provider status">
            {statusCopy}
          </FormIntroCallout>
        ) : null}
        <div className="provider-card-grid section-spaced">
          {majorProviderCards.map((provider) => {
            const providerActionsLabel = `${provider.name} provider actions`;
            const providerPrimaryActionLabel = `${provider.actionLabel}: ${provider.name} provider setup`;
            const providerSyncLabel = provider.syncLabel ?? "Sync recent Gmail";
            const providerSyncActionLabel = `${providerSyncLabel}: import recent matched ${provider.name} messages`;
            return (
              <div className="provider-card" key={provider.name}>
                <CompactTitleRow actions={<Badge>{provider.status}</Badge>} title={provider.name} />
                <p>{provider.detail}</p>
                {provider.accountEmail ? <p>Connected account: {provider.accountEmail}</p> : null}
                {provider.lastSyncAt ? <p>Last sync: {formatDate(provider.lastSyncAt)}</p> : null}
                {provider.lastError ? <p>Last sync issue: {provider.lastError}</p> : null}
                {provider.scopes.length > 0 ? <p>Scopes: {provider.scopes.join(", ")}</p> : null}
                {provider.disabled || !provider.href ? (
                  <button
                    aria-label={providerPrimaryActionLabel}
                    className="button-secondary button-compact"
                    disabled
                    title={providerPrimaryActionLabel}
                    type="button"
                  >
                    {provider.actionLabel}
                  </button>
                ) : (
                  <ActionGroup className="filter-actions" label={providerActionsLabel}>
                    <Link
                      aria-label={providerPrimaryActionLabel}
                      className="button-primary button-compact"
                      href={provider.href as Route}
                      title={providerPrimaryActionLabel}
                    >
                      {provider.actionLabel}
                    </Link>
                    {provider.syncAvailable ? (
                      <form
                        action={
                          provider.provider === "MICROSOFT_365"
                            ? syncRecentMicrosoftFromEmailPageAction
                            : syncRecentGmailFromEmailPageAction
                        }
                      >
                        <button
                          aria-label={providerSyncActionLabel}
                          className="button-secondary button-compact"
                          title={providerSyncActionLabel}
                          type="submit"
                        >
                          {providerSyncLabel}
                        </button>
                      </form>
                    ) : null}
                  </ActionGroup>
                )}
              </div>
            );
          })}
        </div>
        {imapProvider ? (
          <EmailScopeCallout title="Provider roadmap">
            IMAP/SMTP is planned as a fallback for Yahoo Mail, Zoho Mail, Fastmail, iCloud, custom domains, and
            hosting-provider email. It is not live yet.
          </EmailScopeCallout>
        ) : null}
      </section>

      {syncSummary ? (
        <section className="data-card section-separated">
          <PanelTitleRow actions={<Badge>{syncSummary.provider}</Badge>} title="Latest Sync Result" />
          <div className="stat-grid stat-grid-compact email-sync-metrics">
            <StatCard label="Fetched" value={syncSummary.totalFetched} />
            <StatCard label="Logged" value={syncSummary.created} />
            <StatCard label="Duplicates" value={syncSummary.duplicates} />
            <StatCard label="Unmatched" value={syncSummary.skipped} />
          </div>
          <FormIntroCallout className="email-status-callout" title="Sync scope">
            Last sync: {syncSummary.lastSyncAt ? formatDate(syncSummary.lastSyncAt) : "Just now"}. Synced emails are
            logged only when they match known CRM contacts. Unmatched previews below are temporary and not stored as CRM
            history.
          </FormIntroCallout>
          {syncSummary.totalFetched > 0 && syncSummary.created === 0 ? (
            <FormIntroCallout className="email-status-callout email-sync-followup" title="Next step">
              No matches yet — add contacts or create them from email so future syncs can link messages to CRM timelines.
            </FormIntroCallout>
          ) : null}
        </section>
      ) : null}

      {latestSyncReview?.unmatchedPreviews.length ? (
        <section className="data-card section-separated">
          <PanelTitleRow actions={<Badge>Temporary</Badge>} title="Unmatched Email Review" />
          <EmailScopeCallout title="Review scope">
            These recent messages did not match existing contacts. Create a contact or lead, or ignore them for now.
            Northstar is not storing unmatched inbox history.
          </EmailScopeCallout>
          <div className="email-command-list">
            {latestSyncReview.unmatchedPreviews.map((preview) => (
              <EmailPreviewCard
                draftTemplates={draftTemplates}
                key={`${preview.provider}-${preview.providerMessageId}`}
                preview={preview}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="data-card section-separated">
        <PanelTitleRow
          actions={
            <Badge>
              {priorityQueueSummary[0]?.count
                ? `${priorityQueueSummary[0].count} priority`
                : smartLabelReadiness.configured
                  ? "Ready"
                  : "Setup needed"}
            </Badge>
          }
          title="Relationship Inbox Queue"
        />
        <EmailScopeCallout title="Suggested priorities">
          Smart Labels are saved only after you classify a stored email. They are suggested relationship signals, not
          commands: Northstar does not create activities, notes, leads, or profile facts from viewing this queue.
        </EmailScopeCallout>
        <ActionGroup className="relationship-inbox-filter-bar" label="Relationship Inbox priority filters">
          {priorityQueueSummary.map((item) => (
            <Link
              aria-current={item.id === activeInboxFilter ? "page" : undefined}
              aria-label={`Show ${item.label} Relationship Inbox emails`}
              className={item.id === activeInboxFilter ? "button-primary button-compact" : "button-secondary button-compact"}
              href={item.href}
              key={item.id}
              title={`Show ${item.label} Relationship Inbox emails`}
            >
              {item.label} ({item.count})
            </Link>
          ))}
        </ActionGroup>
        {priorityQueueItems.length > 0 ? (
          <div className="relationship-inbox-signal-list">
            {priorityQueueItems.map((item) => {
              const emailLog = item.emailLog;
              const reviewHref = `#email-card-${emailLog.id}` as Route;
              return (
                <article className="relationship-inbox-signal-row" key={emailLog.id}>
                  <CompactTitleRow
                    actions={<Badge>{item.priorityLabel}</Badge>}
                    description={`${emailLog.direction === "INBOUND" ? "From" : "To"} ${
                      emailLog.direction === "INBOUND" ? emailLog.fromText ?? "Not recorded" : emailLog.toText ?? "Not recorded"
                    } · ${formatDate(emailLog.occurredAt)}`}
                    title={emailLog.subject}
                  />
                  <ActionGroup className="filter-actions" label={`${emailLog.subject} relationship inbox smart labels`}>
                    {item.labels.slice(0, 5).map((label) => (
                      <Badge key={label}>{label}</Badge>
                    ))}
                    {item.classification ? <Badge>{Math.round(item.classification.confidence * 100)}% confidence</Badge> : null}
                  </ActionGroup>
                  <div className="relationship-inbox-row-meta">
                    <span>{item.linkedRecord ? `Linked: ${item.linkedRecord.label}` : "No linked CRM record"}</span>
                    <span>{emailFollowUpStateLabel(item.followUpState)}</span>
                    {item.followUps.length > 1 ? <span>{item.followUps.length} linked follow-ups</span> : null}
                  </div>
                  <RelationshipInboxQueueExplainer explainer={item.explainer} subject={emailLog.subject} />
                  <EmailLinkedFollowUps compact followUps={item.followUps} subject={emailLog.subject} workspaceId={workspace.id} />
                  <RelationshipInboxNextBestAction action={item.nextBestAction} subject={emailLog.subject} workspaceId={workspace.id} />
                  <p className="form-hint">{item.classification?.summary ?? "No Smart Label saved yet."}</p>
                  <ActionGroup className="filter-actions" label={`${emailLog.subject} relationship inbox actions`}>
                    <Link
                      aria-label={`Review email card for ${emailLog.subject}`}
                      className="button-secondary button-compact"
                      href={reviewHref}
                      title={`Review email card for ${emailLog.subject}`}
                    >
                      Review
                    </Link>
                    <Link
                      aria-label={`View full evidence trail for email ${emailLog.subject}`}
                      className="button-secondary button-compact"
                      href={item.explainer.detailHref}
                      title={`View full evidence trail for email ${emailLog.subject}`}
                    >
                      View evidence
                    </Link>
                    <Link
                      aria-label={`Draft AI reply for email ${emailLog.subject}`}
                      className="button-secondary button-compact"
                      href={reviewHref}
                      title={`Draft AI reply for email ${emailLog.subject}`}
                    >
                      Draft reply
                    </Link>
                    <Link
                      aria-label={`Create or review follow-up for email ${emailLog.subject}`}
                      className="button-secondary button-compact"
                      href={item.followUps[0]?.href ?? reviewHref}
                      title={`Create or review follow-up for email ${emailLog.subject}`}
                    >
                      {item.followUps.length > 0 ? "Open follow-up" : "Review follow-up"}
                    </Link>
                  </ActionGroup>
                </article>
              );
            })}
          </div>
        ) : (
          <InlineEmptyStateText>
            No {activeInboxFilterLabel.toLowerCase()} emails in the current Relationship Inbox set. Classify stored emails below
            or clear the queue filter.
          </InlineEmptyStateText>
        )}
      </section>

      {attentionLogs.length > 0 ? (
        <section className="data-card section-separated">
          <PanelTitleRow actions={<Badge>{attentionLogs.length} need attention</Badge>} title="Suggested Follow-ups" />
          <div className="email-command-list">
            {attentionLogs.map((emailLog) => (
              <EmailLogCard
                aiReplyReadiness={aiReplyReadiness}
                draftTemplates={draftTemplates}
                emailLog={emailLog}
                key={emailLog.id}
                followUpDetail={followUpDetails.get(emailLog.id)}
                smartLabelReadiness={smartLabelReadiness}
                priorityExplainer={priorityExplainersByEmailId.get(emailLog.id)}
                workspaceId={workspace.id}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="data-card">
        <PanelTitleRow actions={<Badge>{recentEmailLogs.length} shown</Badge>} title="Synced Emails" />
        {recentEmailLogs.length > 0 ? (
          <div className="email-command-list">
            {recentEmailLogs.map((emailLog) => (
              <EmailLogCard
                aiReplyReadiness={aiReplyReadiness}
                draftTemplates={draftTemplates}
                emailLog={emailLog}
                key={emailLog.id}
                followUpDetail={followUpDetails.get(emailLog.id)}
                smartLabelReadiness={smartLabelReadiness}
                priorityExplainer={priorityExplainersByEmailId.get(emailLog.id)}
                showEvidenceAnchor
                workspaceId={workspace.id}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            description="Log an email manually from a deal, contact, organization, or lead. After Gmail is connected, manual sync will add recent matched messages from known contacts here. No matches yet? Create contacts from unmatched emails after your next sync."
            title="No email activity yet"
          />
        )}
      </section>
    </AppShell>
  );
}

function EmailScopeCallout({ children, title }: { children: ReactNode; title: string }) {
  return (
    <FormIntroCallout className="email-scope-callout" title={title}>
      {children}
    </FormIntroCallout>
  );
}

function RelationshipInboxQueueExplainer({
  explainer,
  subject
}: {
  explainer: EmailPriorityQueueExplainer;
  subject: string;
}) {
  return (
    <div className="relationship-inbox-explainer" aria-label={`Why ${subject} is in the Relationship Inbox queue`}>
      <span className="relationship-inbox-explainer-label">Why this?</span>
      <span className="relationship-inbox-explainer-headline">{explainer.headline}</span>
      <div className="relationship-inbox-explainer-evidence">
        {explainer.evidence.slice(0, 7).map((item) => (
          <Badge
            className={`badge relationship-inbox-evidence-chip relationship-inbox-evidence-${item.tone}`}
            key={`${item.source}-${item.label}`}
            label={`${item.label}. Source: ${emailEvidenceSourceLabel(item.source)}.`}
          >
            {item.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function RelationshipInboxNextBestAction({
  action,
  subject,
  workspaceId
}: {
  action: EmailPriorityNextBestAction;
  subject: string;
  workspaceId: string;
}) {
  const primaryLabel = action.action === "no_action_needed" ? "Review email" : action.label;
  const isCompletionAction = action.action === "mark_follow_up_complete" && action.followUp?.status === "open";
  return (
    <div className="relationship-inbox-next-action">
      <div>
        <div className="relationship-inbox-next-action-badges">
          <Badge>{action.label}</Badge>
          <Badge>{emailNextBestActionSeverityLabel(action.severity)}</Badge>
        </div>
        <p>{action.reason}</p>
      </div>
      {isCompletionAction && action.followUp ? (
        <ActivityCompleteButton
          activityId={action.followUp.id}
          ariaLabel={`Mark recommended follow-up activity ${action.followUp.title} complete for ${subject}`}
          inline
          workspaceId={workspaceId}
        />
      ) : (
        <Link
          aria-label={`${primaryLabel} for ${subject}`}
          className="button-primary button-compact"
          href={action.href}
          title={`${primaryLabel} for ${subject}`}
        >
          {primaryLabel}
        </Link>
      )}
    </div>
  );
}

function emailNextBestActionSeverityLabel(severity: EmailPriorityNextBestAction["severity"]) {
  if (severity === "high") return "High priority";
  if (severity === "medium") return "Medium priority";
  return "Low priority";
}

function emailEvidenceSourceLabel(source: EmailPriorityQueueExplainer["sources"][number]) {
  if (source === "smart_label") return "Smart Label";
  if (source === "crm_link") return "CRM link state";
  if (source === "durable_follow_up") return "Durable follow-up link";
  return "Legacy follow-up marker";
}

type ProviderCard = NonNullable<Awaited<ReturnType<typeof listEmailConnectionProviderCards>>[number]>;

function buildMajorProviderCards({
  gmailProvider,
  microsoftProvider
}: {
  gmailProvider?: ProviderCard;
  microsoftProvider?: ProviderCard;
}) {
  const gmailBase = gmailProvider ?? {
    actionLabel: "Configure OAuth",
    detail: "Add Google OAuth env vars before Gmail or Google Workspace can connect.",
    disabled: true,
    name: "Gmail",
    provider: "GOOGLE_WORKSPACE" as const,
    scopes: [],
    status: "Not configured"
  };
  const microsoftBase = microsoftProvider ?? {
    actionLabel: "Configure OAuth",
    detail: "Add Microsoft OAuth env vars and token encryption before Microsoft 365 or Outlook can connect.",
    disabled: true,
    name: "Microsoft 365",
    provider: "MICROSOFT_365" as const,
    scopes: [],
    status: "Not configured"
  };

  return [
    { ...gmailBase, actionLabel: gmailActionLabel(gmailBase, "Gmail"), name: "Gmail", syncLabel: "Sync recent Gmail" },
    {
      ...gmailBase,
      actionLabel: gmailActionLabel(gmailBase, "Google Workspace"),
      detail:
        gmailBase.status === "Connected"
          ? "Google Workspace mailbox connected through the existing Gmail metadata sync path."
          : "Connect a Google Workspace mailbox through the same Google OAuth and Gmail metadata sync path.",
      name: "Google Workspace",
      syncLabel: "Sync recent Google Workspace"
    },
    {
      ...microsoftBase,
      actionLabel: microsoftActionLabel(microsoftBase, "Microsoft 365"),
      detail: microsoftProviderDetail(microsoftBase, "Microsoft 365"),
      disabled: microsoftBase.disabled,
      href: microsoftBase.href,
      name: "Microsoft 365",
      syncAvailable: microsoftBase.syncAvailable,
      syncLabel: "Sync recent Microsoft 365 mail",
      status: microsoftBase.status
    },
    {
      ...microsoftBase,
      actionLabel: microsoftActionLabel(microsoftBase, "Outlook"),
      detail: microsoftProviderDetail(microsoftBase, "Outlook"),
      disabled: microsoftBase.disabled,
      href: microsoftBase.href,
      name: "Outlook",
      syncAvailable: microsoftBase.syncAvailable,
      syncLabel: "Sync recent Outlook mail",
      status: microsoftBase.status
    }
  ];
}

function gmailActionLabel(provider: ProviderCard, label: "Gmail" | "Google Workspace") {
  if (provider.disabled) return provider.actionLabel;
  if (provider.syncAvailable) return `Reconnect ${label}`;
  return `Connect ${label}`;
}

function microsoftActionLabel(provider: ProviderCard, label: "Microsoft 365" | "Outlook") {
  if (provider.disabled) return provider.actionLabel;
  if (provider.syncAvailable) return `Reconnect ${label}`;
  return `Connect ${label}`;
}

function microsoftProviderDetail(provider: ProviderCard, label: "Microsoft 365" | "Outlook") {
  if (provider.disabled) {
    return label === "Microsoft 365"
      ? "Microsoft 365 uses the Microsoft Graph provider path. Configure Microsoft OAuth env vars and token encryption to enable it."
      : "Outlook uses the Microsoft 365 / Microsoft Graph provider path. Configure Microsoft OAuth env vars and token encryption to enable it.";
  }
  return label === "Microsoft 365"
    ? "Connect Microsoft 365 through Microsoft Graph with read-only profile and mail scopes."
    : "Connect Outlook through the same Microsoft Graph metadata sync path.";
}

function formatEmailProvider(provider: string | null) {
  if (provider === "GOOGLE_WORKSPACE") return "Gmail";
  if (provider === "MICROSOFT_365") return "Microsoft";
  return "Manual";
}

function isSyncResult(status: string | undefined) {
  return status === "gmail-synced" || status === "microsoft-synced";
}

function buildSyncSummary(
  searchParams: Awaited<EmailPageProps["searchParams"]>,
  syncReview: ReturnType<typeof decodeEmailSyncReview>,
  providerCards: ReturnType<typeof buildMajorProviderCards>
) {
  if (!isSyncResult(searchParams?.emailConnection)) return null;
  const provider = searchParams?.emailConnection === "microsoft-synced" ? "Microsoft" : "Gmail";
  const providerStatus = providerCards.find((card) =>
    provider === "Microsoft" ? card.provider === "MICROSOFT_365" : card.provider === "GOOGLE_WORKSPACE"
  );
  return {
    created: numberParam(searchParams?.created, syncReview?.created),
    duplicates: numberParam(searchParams?.duplicates, syncReview?.duplicates),
    lastSyncAt: providerStatus?.lastSyncAt ?? null,
    provider,
    skipped: numberParam(searchParams?.skipped, syncReview?.skipped),
    totalFetched: numberParam(searchParams?.total, syncReview?.totalFetched)
  };
}

function numberParam(value: string | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

type EmailLog = Awaited<ReturnType<typeof listEmailLogs>>[number];
type DraftTemplate = {
  body: string;
  id: string;
  name: string;
  subject: string;
};

function EmailLogCard({
  aiReplyReadiness,
  draftTemplates,
  emailLog,
  followUpDetail,
  priorityExplainer,
  showEvidenceAnchor = false,
  smartLabelReadiness,
  workspaceId
}: {
  aiReplyReadiness: EmailReplyAssistantReadiness;
  draftTemplates: DraftTemplate[];
  emailLog: EmailLog;
  followUpDetail?: EmailPriorityFollowUpDetail;
  priorityExplainer?: EmailPriorityQueueExplainer;
  showEvidenceAnchor?: boolean;
  smartLabelReadiness: EmailClassificationReadiness;
  workspaceId: string;
}) {
  const recipientEmail = primaryEmailForDraft(emailLog.direction, emailLog.fromText, emailLog.toText);
  const emailStatusLabel = `${emailLog.subject} email status`;
  const emailActionsLabel = `${emailLog.subject} email actions`;
  const createDealFromEmailLabel = `Create deal from email ${emailLog.subject}`;
  const smartClassification = readEmailSmartClassification(emailLog);
  const followUpDraft = buildEmailFollowUpDraftFromEmailLog(emailLog);
  return (
    <article className="email-command-card" id={`email-card-${emailLog.id}`}>
      <CompactTitleRow
        actions={<Badge>{formatEmailProvider(emailLog.provider)}</Badge>}
        description={
          <>
            {emailLog.direction === "INBOUND" ? "From" : "To"}{" "}
            {emailLog.direction === "INBOUND" ? emailLog.fromText ?? "Not recorded" : emailLog.toText ?? "Not recorded"} ·{" "}
            {formatDate(emailLog.occurredAt)}
          </>
        }
        title={emailLog.subject}
      />
      <ActionGroup className="filter-actions" label={emailStatusLabel}>
        {emailStatusBadges(emailLog).map((badge) => (
          <Badge key={badge}>
            {badge}
          </Badge>
        ))}
      </ActionGroup>
      <EmailSmartLabelPanel
        emailLogId={emailLog.id}
        initialClassification={smartClassification}
        readiness={smartLabelReadiness}
        subject={emailLog.subject}
      />
      <EmailLinkedFollowUps followUps={followUpDetail?.followUps ?? []} subject={emailLog.subject} workspaceId={workspaceId} />
      {priorityExplainer ? (
        <RelationshipInboxEvidenceDetail
          explainer={priorityExplainer}
          subject={emailLog.subject}
          targetId={showEvidenceAnchor ? `email-evidence-${emailLog.id}` : undefined}
        />
      ) : null}
      <EmailFollowUpPanel draft={followUpDraft} subject={emailLog.subject} />
      <p className="email-preview">{formatEmailPreview(emailLog.body)}</p>
      <EmailLogLinks emailLog={emailLog} />
      <ActionGroup className="filter-actions" label={emailActionsLabel}>
        {emailLog.person ? (
          <Link
            aria-label={createDealFromEmailLabel}
            className="button-secondary button-compact"
            href={"/deals/new" as Route}
            title={createDealFromEmailLabel}
          >
            Create deal
          </Link>
        ) : null}
        <EmailDraftPanel
          recipientEmail={recipientEmail}
          subject={emailLog.subject}
          templates={draftTemplates.map((template) => ({
            body: template.body,
            id: template.id,
            name: template.name,
            subject: template.subject
          }))}
        />
      </ActionGroup>
      <EmailAiReplyPanel
        emailLogId={emailLog.id}
        readiness={aiReplyReadiness}
        recipientEmail={recipientEmail}
        subject={emailLog.subject}
      />
    </article>
  );
}

function RelationshipInboxEvidenceDetail({
  explainer,
  subject,
  targetId
}: {
  explainer: EmailPriorityQueueExplainer;
  subject: string;
  targetId?: string;
}) {
  const categoryItems = explainer.trail.filter((item) => item.type === "category");
  const signalItems = explainer.trail.filter((item) => item.type === "signal");
  const remainingTrailItems = explainer.trail.filter((item) => item.type !== "category" && item.type !== "signal");
  const savedExcerpts = uniqueEvidenceExcerpts(
    explainer.trail.flatMap((item) => [...(item.excerpts ?? []), ...(item.excerpt ? [item.excerpt] : [])])
  );
  return (
    <section
      aria-label={`Full Relationship Inbox evidence for ${subject}`}
      className="relationship-inbox-evidence-detail"
      id={targetId}
    >
      <div className="relationship-inbox-evidence-detail-header">
        <div>
          <span className="relationship-inbox-explainer-label">Relationship Inbox evidence</span>
          <p>{explainer.headline}</p>
        </div>
        <Badge>{emailNextBestActionSeverityLabel(explainer.severity)}</Badge>
      </div>
      {categoryItems.length > 0 ? (
        <div className="relationship-inbox-evidence-group">
          <span className="relationship-inbox-explainer-label">Category evidence</span>
          {categoryItems.map((item) => (
            <RelationshipInboxEvidenceDrilldown item={item} key={item.id} />
          ))}
        </div>
      ) : null}
      {signalItems.length > 0 ? (
        <div className="relationship-inbox-evidence-group">
          <span className="relationship-inbox-explainer-label">Signal evidence</span>
          {signalItems.map((item) => (
            <RelationshipInboxEvidenceDrilldown item={item} key={item.id} />
          ))}
        </div>
      ) : null}
      <div className="relationship-inbox-evidence-trail">
        <span className="relationship-inbox-explainer-label">CRM, follow-up, and action trail</span>
        {remainingTrailItems.map((item) => (
          <RelationshipInboxEvidenceTrailItem item={item} key={item.id} />
        ))}
      </div>
      {savedExcerpts.length > 0 ? (
        <div className="relationship-inbox-source-excerpts">
          <span className="relationship-inbox-explainer-label">Supporting excerpts</span>
          {savedExcerpts.map((item) => (
            <blockquote className="relationship-inbox-evidence-excerpt" key={`excerpt-${item}`}>
              {item}
            </blockquote>
          ))}
          <p className="form-hint">
            These are saved Smart Label excerpts. Exact source text offsets are not stored, so Northstar does not claim
            character-level highlights.
          </p>
        </div>
      ) : (
        <p className="form-hint">No saved source excerpts are available for this queue item.</p>
      )}
    </section>
  );
}

function RelationshipInboxEvidenceDrilldown({ item }: { item: EmailPriorityQueueEvidenceTrailItem }) {
  const excerpts = item.excerpts ?? [];
  const targetLabel = item.target?.label ?? "Review evidence";
  return (
    <details className="relationship-inbox-evidence-drilldown" open={excerpts.length > 0}>
      <summary>
        <Badge
          className={`badge relationship-inbox-evidence-chip relationship-inbox-evidence-${item.tone}`}
          label={`${item.label}. Source: ${emailEvidenceSourceLabel(item.source)}.`}
        >
          {item.label}
        </Badge>
        <span>{item.reason}</span>
      </summary>
      {excerpts.length > 0 ? (
        <div className="relationship-inbox-evidence-drilldown-body">
          {excerpts.map((excerpt) => (
            <blockquote className="relationship-inbox-evidence-excerpt" key={`${item.id}-${excerpt}`}>
              {excerpt}
            </blockquote>
          ))}
        </div>
      ) : (
        <p className="form-hint">No signal-specific excerpt is saved for this label; see the flat supporting excerpts below.</p>
      )}
      {item.target ? (
        <Link
          aria-label={`${targetLabel} for evidence ${item.label}`}
          className="inline-link"
          href={item.target.href}
          title={`${targetLabel} for evidence ${item.label}`}
        >
          {targetLabel}
        </Link>
      ) : null}
    </details>
  );
}

function RelationshipInboxEvidenceTrailItem({ item }: { item: EmailPriorityQueueEvidenceTrailItem }) {
  const targetLabel = item.target?.label ?? "Review evidence";
  return (
    <div className="relationship-inbox-evidence-trail-item">
      <div className="relationship-inbox-evidence-trail-main">
        <Badge
          className={`badge relationship-inbox-evidence-chip relationship-inbox-evidence-${item.tone}`}
          label={`${item.label}. Source: ${emailEvidenceSourceLabel(item.source)}.`}
        >
          {item.label}
        </Badge>
        <p>{item.reason}</p>
        {item.excerpts?.map((excerpt) => (
          <blockquote className="relationship-inbox-evidence-excerpt" key={`${item.id}-${excerpt}`}>
            {excerpt}
          </blockquote>
        ))}
        {item.excerpt ? <blockquote className="relationship-inbox-evidence-excerpt">{item.excerpt}</blockquote> : null}
        {item.followUp ? (
          <p className="form-hint">
            Follow-up: {item.followUp.title} · {item.followUp.status === "completed" ? "Completed" : "Open"}
            {item.followUp.dueAt ? ` · Due ${formatDate(item.followUp.dueAt)}` : ""}
            {item.followUp.completedAt ? ` · Completed ${formatDate(item.followUp.completedAt)}` : ""}
          </p>
        ) : null}
      </div>
      {item.target ? (
        <Link
          aria-label={`${targetLabel} for evidence ${item.label}`}
          className="button-secondary button-compact"
          href={item.target.href}
          title={`${targetLabel} for evidence ${item.label}`}
        >
          {targetLabel}
        </Link>
      ) : null}
    </div>
  );
}

function uniqueEvidenceExcerpts(values: string[]) {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

function EmailLinkedFollowUps({
  compact = false,
  followUps,
  subject,
  workspaceId
}: {
  compact?: boolean;
  followUps: EmailLinkedFollowUpSummary[];
  subject: string;
  workspaceId: string;
}) {
  if (followUps.length === 0) return null;
  const visibleFollowUps = compact ? followUps.slice(0, 1) : followUps;
  const linkedFollowUpsLabel = `${subject} linked follow-up activities`;

  return (
    <div className={compact ? "email-linked-follow-ups email-linked-follow-ups-compact" : "email-linked-follow-ups"}>
      <ActionGroup className="filter-actions" label={linkedFollowUpsLabel}>
        <Badge>{followUps.length === 1 ? "1 linked follow-up" : `${followUps.length} linked follow-ups`}</Badge>
        {followUps.some((followUp) => followUp.status === "open") ? <Badge>Open follow-up</Badge> : <Badge>Completed</Badge>}
      </ActionGroup>
      <div className="email-linked-follow-up-list">
        {visibleFollowUps.map((followUp) => (
          <div className="email-linked-follow-up-row" key={followUp.id}>
            <div className="email-linked-follow-up-main">
              <span className="email-linked-follow-up-title">{followUp.title}</span>
              <span className="muted">
                {emailLinkedFollowUpStatusLabel(followUp)} · {followUp.dueAt ? `Due ${formatDate(followUp.dueAt)}` : "No due date"}
                {followUp.linkedRecord ? ` · ${followUp.linkedRecord.label}` : ""}
              </span>
            </div>
            <ActionGroup className="filter-actions" label={`${followUp.title} follow-up actions`}>
              {followUp.source === "legacy" ? <Badge>Legacy match</Badge> : null}
              <Link
                aria-label={`Open linked follow-up activity ${followUp.title}`}
                className="button-secondary button-compact"
                href={followUp.href}
                title={`Open linked follow-up activity ${followUp.title}`}
              >
                Open follow-up
              </Link>
              {followUp.status === "open" ? (
                <ActivityCompleteButton
                  activityId={followUp.id}
                  ariaLabel={`Mark linked follow-up activity ${followUp.title} complete`}
                  inline
                  workspaceId={workspaceId}
                />
              ) : null}
            </ActionGroup>
          </div>
        ))}
      </div>
      {compact && followUps.length > visibleFollowUps.length ? (
        <p className="form-hint">{followUps.length - visibleFollowUps.length} more linked follow-up activities on the email card.</p>
      ) : null}
    </div>
  );
}

function emailLinkedFollowUpStatusLabel(followUp: EmailLinkedFollowUpSummary) {
  return followUp.status === "completed" && followUp.completedAt
    ? `Completed ${formatDate(followUp.completedAt)}`
    : followUp.status === "completed"
      ? "Completed"
      : "Open";
}

function EmailPreviewCard({ draftTemplates, preview }: { draftTemplates: DraftTemplate[]; preview: EmailSyncPreview }) {
  const name = displayNameFromParticipant(preview.direction === "INBOUND" ? preview.fromText : preview.toText);
  const contactHref = buildContactHref(preview.email, name);
  const leadHref = buildLeadHref(preview.email, preview.subject);
  const previewStatusLabel = `${preview.subject} unmatched email status`;
  const previewActionsLabel = `${preview.subject} unmatched email actions`;
  const createContactFromPreviewLabel = `Create contact from unmatched email ${preview.subject}`;
  const createLeadFromPreviewLabel = `Create lead from unmatched email ${preview.subject}`;
  return (
    <article className="email-command-card email-command-card-unmatched">
      <CompactTitleRow
        actions={<Badge>{formatEmailProvider(preview.provider)}</Badge>}
        description={
          <>
            {preview.direction === "INBOUND" ? "From" : "To"}{" "}
            {preview.direction === "INBOUND" ? preview.fromText ?? preview.email ?? "Unknown" : preview.toText ?? preview.email ?? "Unknown"} ·{" "}
            {formatDate(preview.occurredAt)}
          </>
        }
        title={preview.subject}
      />
      <ActionGroup className="filter-actions" label={previewStatusLabel}>
        <Badge>Unmatched</Badge>
        <Badge>Possible new contact</Badge>
        {preview.direction === "INBOUND" ? <Badge>Follow-up suggested</Badge> : null}
      </ActionGroup>
      {preview.snippet ? <p className="email-preview">{preview.snippet}</p> : null}
      <ActionGroup className="filter-actions" label={previewActionsLabel}>
        <Link
          aria-label={createContactFromPreviewLabel}
          className="button-secondary button-compact"
          href={contactHref}
          title={createContactFromPreviewLabel}
        >
          Create contact
        </Link>
        <Link
          aria-label={createLeadFromPreviewLabel}
          className="button-secondary button-compact"
          href={leadHref}
          title={createLeadFromPreviewLabel}
        >
          Create lead
        </Link>
        <span className="muted">Ignore for now</span>
      </ActionGroup>
      <EmailDraftPanel
        recipientEmail={preview.email}
        subject={preview.subject}
        templates={draftTemplates.map((template) => ({
          body: template.body,
          id: template.id,
          name: template.name,
          subject: template.subject
        }))}
      />
    </article>
  );
}

function emailNeedsAttention(emailLog: EmailLog) {
  return emailLog.direction === "INBOUND" || (emailLog.deal?.status === "OPEN");
}

function emailStatusBadges(emailLog: EmailLog) {
  const badges = ["Linked"];
  if (emailLog.deal?.status === "OPEN") badges.push("Deal communication");
  if (emailLog.direction === "INBOUND") badges.push(isOlderThanDays(emailLog.occurredAt, 3) ? "Needs follow-up" : "Follow-up suggested");
  if (emailLog.providerMessageId) badges.push("Synced");
  return badges;
}

function isOlderThanDays(value: Date | string, days: number) {
  return new Date(value).getTime() < Date.now() - days * 24 * 60 * 60 * 1000;
}

function formatEmailPreview(body: string) {
  const stripped = body.replace(/^(Gmail|Microsoft) snippet:\s*/i, "");
  return stripped.length > 260 ? `${stripped.slice(0, 259)}...` : stripped;
}

function primaryEmailForDraft(direction: string, fromText: string | null, toText: string | null) {
  const source = direction === "INBOUND" ? fromText : toText;
  return extractFirstEmail(source);
}

function extractFirstEmail(value: string | null | undefined) {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function displayNameFromParticipant(value: string | null | undefined) {
  if (!value) return undefined;
  const withoutEmail = value.replace(/<[^>]+>/g, "").trim();
  return withoutEmail && !withoutEmail.includes("@") ? withoutEmail.slice(0, 120) : undefined;
}

function buildContactHref(email: string | null, name?: string) {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (name) params.set("name", name);
  const query = params.toString();
  return (query ? `/contacts/new?${query}` : "/contacts/new") as Route;
}

function buildLeadHref(email: string | null, subject: string) {
  const params = new URLSearchParams();
  params.set("source", "Email");
  params.set("title", email ? `Email from ${email}` : subject || "Email follow-up");
  return `/leads/new?${params.toString()}` as Route;
}

function emailStatusCopy(searchParams: Awaited<EmailPageProps["searchParams"]>) {
  if (searchParams?.emailConnection === "gmail-synced") {
    return `Recent Gmail sync finished. Imported ${searchParams.created ?? "0"} matched message${
      searchParams.created === "1" ? "" : "s"
    }; skipped ${searchParams.skipped ?? "0"} unmatched and ${searchParams.duplicates ?? "0"} duplicate.`;
  }
  if (searchParams?.emailConnection === "microsoft-synced") {
    return `Recent Microsoft mail sync finished. Imported ${searchParams.created ?? "0"} matched message${
      searchParams.created === "1" ? "" : "s"
    }; skipped ${searchParams.skipped ?? "0"} unmatched and ${searchParams.duplicates ?? "0"} duplicate.`;
  }
  if (searchParams?.emailConnection === "gmail-sync-error") {
    return "Recent Gmail sync was not completed. Reconnect Gmail or check provider configuration.";
  }
  if (searchParams?.emailConnection === "microsoft-sync-error") {
    return "Recent Microsoft mail sync was not completed. Reconnect Microsoft or check provider configuration.";
  }
  return null;
}

function EmailLogLinks({
  emailLog
}: {
  emailLog: Awaited<ReturnType<typeof listEmailLogs>>[number];
}) {
  const links = [
    emailLog.person
      ? {
          href: `/contacts/${emailLog.person.id}` as Route,
          label: formatPersonName(emailLog.person) ?? "Unnamed contact",
          type: "contact"
        }
      : null,
    emailLog.organization
      ? {
          href: `/organizations/${emailLog.organization.id}` as Route,
          label: emailLog.organization.name,
          type: "account"
        }
      : null,
    emailLog.deal
      ? {
          href: `/deals/${emailLog.deal.id}` as Route,
          label: emailLog.deal.title,
          type: "deal"
        }
      : null,
    emailLog.lead
      ? {
          href: `/leads/${emailLog.lead.id}` as Route,
          label: emailLog.lead.title,
          type: "lead"
        }
      : null
  ].filter((link): link is { href: Route; label: string; type: "account" | "contact" | "deal" | "lead" } =>
    Boolean(link)
  );

  if (links.length === 0) return <InlineEmptyStateText>No linked CRM record</InlineEmptyStateText>;

  const linkedRecordsLabel = "Linked CRM records";

  return (
    <ActionGroup className="filter-actions" label={linkedRecordsLabel}>
      {links.map((link) => {
        const linkedRecordActionLabel = `Open linked ${link.type} ${link.label} from email ${emailLog.subject}`;
        return (
          <Link
            aria-label={linkedRecordActionLabel}
            className="inline-link"
            href={link.href}
            key={`${link.href}-${link.label}`}
            title={linkedRecordActionLabel}
          >
            {link.label}
          </Link>
        );
      })}
    </ActionGroup>
  );
}
