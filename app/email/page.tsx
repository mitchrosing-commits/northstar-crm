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
  listEmailInboxThreads,
  listEmailPriorityFollowUpDetails,
  listEmailLogs,
  listEmailTemplates,
  normalizeEmailPriorityQueueFilter,
  readEmailSmartClassification
} from "@/lib/services/crm";
import type { EmailClassificationReadiness } from "@/lib/services/email-classification-service";
import type {
  EmailLinkedFollowUpSummary,
  EmailPriorityActionExplanation,
  EmailPriorityFollowUpDetail,
  EmailPriorityNextBestAction,
  EmailPriorityQueueExplainer,
  EmailPriorityQueueEvidenceTrailItem
} from "@/lib/services/email-priority-queue-service";
import type { EmailReplyAssistantReadiness } from "@/lib/services/email-reply-assistant-service";
import type { EmailInboxThreadSummary, EmailSyncPreview } from "@/lib/services/email-connection-service";
import {
  disconnectEmailProviderFromEmailPageAction,
  loadOlderGmailInboxFromEmailPageAction,
  refreshGmailThreadFromEmailPageAction,
  sendGmailReplyFromEmailPageAction,
  syncGmailInboxFromEmailPageAction,
  syncRecentMicrosoftFromEmailPageAction
} from "./actions";
import { decodeEmailSyncReview, emailSyncReviewCookieName } from "./sync-review";

export const dynamic = "force-dynamic";

type EmailPageProps = {
  searchParams?: Promise<{
    created?: string;
    duplicates?: string;
    emailConnection?: string;
    inbox?: string;
    skipped?: string;
    thread?: string;
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
  const [providers, recentEmailLogs, emailTemplates, inboxThreads] = await Promise.all([
    listEmailConnectionProviderCards(actor),
    listEmailLogs(actor, { limit: 25 }),
    listEmailTemplates(actor, { activeOnly: true }),
    listEmailInboxThreads(actor, { limit: 75 })
  ]);
  const selectedInboxThread =
    inboxThreads.find((thread) => thread.id === resolvedSearchParams?.thread) ?? inboxThreads[0] ?? null;
  const oldestInboxMessageAt = oldestInboxMessageDate(inboxThreads);
  const selectedInboxFollowUpDetails = await listEmailPriorityFollowUpDetails(actor, selectedInboxThread?.messages ?? []);
  const followUpDetails = await listEmailPriorityFollowUpDetails(actor, recentEmailLogs);
  const gmailProvider = providers.find((provider) => provider.provider === "GOOGLE_WORKSPACE");
  const microsoftProvider = providers.find((provider) => provider.provider === "MICROSOFT_365");
  const imapProvider = providers.find((provider) => provider.provider === "IMAP_SMTP");
  const majorProviderCards = buildMajorProviderCards({ gmailProvider, microsoftProvider });
  const gmailReadiness = gmailFullInboxReadiness(gmailProvider);
  const fullInboxEmptyState = fullInboxEmptyStateCopy(gmailProvider, inboxThreads.length);
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
        subtitle="Work synced mailbox threads, relationship-priority messages, Smart Labels, AI reply drafts, and review-first follow-ups from one place."
        title="Inbox"
      />

      <section className="panel inbox-workflow-map" aria-label="Inbox workflow map">
        <PanelTitleRow
          actions={<Badge>Review-first</Badge>}
          description="Email intelligence lives inside the Inbox workflow. Nothing here auto-sends, auto-classifies, creates CRM records, or creates follow-ups without review."
          title="Inbox Workflows"
        />
        <div className="inbox-workflow-grid">
          <InboxWorkflowItem
            detail="Synced Gmail threads, stored readable bodies, explicit replies, and selected-thread refresh."
            label="Full Inbox"
          />
          <InboxWorkflowItem
            detail="CRM-prioritized stored emails with suggested next actions and relationship-risk signals."
            label="Relationship Inbox"
          />
          <InboxWorkflowItem
            detail="User-triggered classification snapshots with evidence attached to stored messages."
            label="Smart Labels"
          />
          <InboxWorkflowItem
            detail="Draft-only reply assistance inside an email card; the user still reviews and sends."
            label="AI Reply Assistant"
          />
          <InboxWorkflowItem
            detail="Review-first activity drafting and durable linked follow-up history from email context."
            label="Follow-ups"
          />
        </div>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow actions={<Badge>{gmailProvider?.status ?? "Not configured"}</Badge>} title="Email Providers" />
        <EmailScopeCallout title="Sync boundaries">
          Gmail Full Inbox sync stores recent inbox messages and full readable bodies for review in Northstar. Replies
          are sent only from an explicit user action. Microsoft sync remains metadata-focused and CRM-matched for now.
        </EmailScopeCallout>
        {!gmailReadiness.ready ? (
          <EmptyState
            className="email-provider-empty"
            description={gmailReadiness.description}
            title={gmailReadiness.title}
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
            const providerDisconnectLabel = `Disconnect ${provider.name} account ${provider.accountEmail ?? ""}`.trim();
            const providerSyncActionLabel =
              provider.provider === "MICROSOFT_365"
                ? `${providerSyncLabel}: import recent matched ${provider.name} messages`
                : `${providerSyncLabel}: store recent Gmail inbox threads`;
            const showDisconnect = shouldShowProviderDisconnect(provider);
            return (
              <div className="provider-card" key={provider.name}>
                <CompactTitleRow actions={<Badge>{provider.status}</Badge>} title={provider.name} />
                <p>{provider.detail}</p>
                {provider.accountEmail ? <p>Connected account: {provider.accountEmail}</p> : null}
                {provider.lastSyncAt ? <p>Last sync: {formatDate(provider.lastSyncAt)}</p> : null}
                {provider.syncStatusLabel ? (
                  <p>
                    Background sync: {provider.syncStatusLabel}
                    {provider.syncStatusDetail ? ` · ${formatProviderSyncStatusDetail(provider.syncStatusDetail)}` : ""}
                  </p>
                ) : null}
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
                            : syncGmailInboxFromEmailPageAction
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
                    {showDisconnect ? (
                      <form action={disconnectEmailProviderFromEmailPageAction}>
                        <input name="provider" type="hidden" value={provider.provider} />
                        <button
                          aria-label={providerDisconnectLabel}
                          className="button-secondary button-compact"
                          title={providerDisconnectLabel}
                          type="submit"
                        >
                          Disconnect
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
            stored for inbox review. Gmail Full Inbox messages may be unlinked until they match or are attached to CRM
            records; Microsoft sync remains CRM-matched metadata.
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
          actions={<Badge>{inboxThreads.length ? `${inboxThreads.length} threads` : "No synced threads"}</Badge>}
          title="Full Inbox"
        />
        <FormIntroCallout className="email-status-callout email-inbox-status" title="Gmail sync status">
          {gmailReadiness.statusLine}
          {gmailProvider?.lastSyncAt ? ` Last synced ${formatDate(gmailProvider.lastSyncAt)}.` : ""}
          {gmailProvider?.syncStatusLabel ? ` Background worker: ${gmailProvider.syncStatusLabel}.` : ""}
          {gmailProvider?.syncStatusDetail ? ` ${formatProviderSyncStatusDetail(gmailProvider.syncStatusDetail)}` : ""}
        </FormIntroCallout>
        <EmailScopeCallout title="Inbox workflow">
          Browse synced Gmail threads, read stored message bodies, and send replies only after writing and submitting
          the reply yourself. Viewing, filtering, and opening threads does not send email or create CRM records.
        </EmailScopeCallout>
        {inboxThreads.length > 0 && selectedInboxThread ? (
          <div className="email-inbox-layout">
            <div className="email-inbox-thread-list-shell">
              <EmailInboxThreadList activeThreadId={selectedInboxThread.id} threads={inboxThreads} />
              {gmailProvider?.syncAvailable && oldestInboxMessageAt ? (
                <form action={loadOlderGmailInboxFromEmailPageAction} className="email-inbox-load-more">
                  <input name="before" type="hidden" value={oldestInboxMessageAt.toISOString()} />
                  <input name="threadId" type="hidden" value={selectedInboxThread.id} />
                  <button
                    aria-label="Load older Gmail inbox messages"
                    className="button-secondary button-compact"
                    title="Load older Gmail inbox messages"
                    type="submit"
                  >
                    Load older messages
                  </button>
                  <span className="form-hint">Before {formatDate(oldestInboxMessageAt)}</span>
                </form>
              ) : null}
            </div>
            <EmailInboxThreadDetail
              aiReplyReadiness={aiReplyReadiness}
              draftTemplates={draftTemplates}
              followUpDetails={selectedInboxFollowUpDetails}
              smartLabelReadiness={smartLabelReadiness}
              thread={selectedInboxThread}
              workspaceId={workspace.id}
            />
          </div>
        ) : (
          <EmptyState
            description={fullInboxEmptyState.description}
            title={fullInboxEmptyState.title}
          />
        )}
      </section>

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
          Relationship Inbox is the CRM action queue for stored email. Smart Labels are saved only after you classify a
          stored email. They are suggested relationship signals, not commands: Northstar does not create activities,
          notes, leads, or profile facts from viewing this queue.
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
                  <RelationshipInboxNextBestAction
                    action={item.nextBestAction}
                    actionExplanation={item.explainer.actionExplanation}
                    subject={emailLog.subject}
                    workspaceId={workspace.id}
                  />
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

function InboxWorkflowItem({ detail, label }: { detail: string; label: string }) {
  return (
    <div className="inbox-workflow-item">
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
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
  actionExplanation,
  subject,
  workspaceId
}: {
  action: EmailPriorityNextBestAction;
  actionExplanation: EmailPriorityActionExplanation;
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
        <div className="relationship-inbox-action-explanation">
          <span className="relationship-inbox-explainer-label">Why this action?</span>
          <p>{actionExplanation.headline}</p>
          {actionExplanation.contributingSignals.length > 0 ? (
            <div className="relationship-inbox-next-action-badges">
              {actionExplanation.contributingSignals.slice(0, 4).map((signal) => (
                <Badge key={signal.key}>{signal.label}</Badge>
              ))}
            </div>
          ) : null}
        </div>
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

function emailFollowUpSourceLabel(source: EmailPriorityActionExplanation["followUpState"]["source"]) {
  if (source === "durable") return "Durable follow-up link";
  if (source === "legacy") return "Legacy marker fallback";
  return "No follow-up source";
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
    { ...gmailBase, actionLabel: gmailActionLabel(gmailBase, "Gmail"), name: "Gmail", syncLabel: "Sync Gmail inbox" },
    {
      ...gmailBase,
      actionLabel: gmailActionLabel(gmailBase, "Google Workspace"),
      detail:
        gmailBase.status === "Connected"
          ? "Google Workspace mailbox connected through the Gmail Full Inbox path for synced reading and explicit replies."
          : "Connect a Google Workspace mailbox through the same Google OAuth path with Gmail read/send scopes.",
      name: "Google Workspace",
      syncLabel: "Sync Google Workspace inbox"
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

function shouldShowProviderDisconnect(provider: ProviderCard) {
  return (
    Boolean(provider.disconnectAvailable && provider.accountEmail) &&
    ((provider.provider === "GOOGLE_WORKSPACE" && provider.name === "Gmail") ||
      (provider.provider === "MICROSOFT_365" && provider.name === "Microsoft 365"))
  );
}

function gmailFullInboxReadiness(provider: ProviderCard | undefined) {
  if (!provider) {
    return {
      description: "Configure Google OAuth and token encryption before Gmail Full Inbox can connect.",
      ready: false,
      statusLine: "Gmail Full Inbox is not configured yet.",
      title: "Gmail setup required"
    };
  }

  if (provider.status === "Not configured") {
    return {
      description: "Add Google OAuth client id, client secret, redirect URI, and token encryption env vars before connecting Gmail.",
      ready: false,
      statusLine: "Gmail OAuth is not configured for Full Inbox sync.",
      title: "Gmail OAuth is not configured"
    };
  }

  if (provider.status === "Token encryption required") {
    return {
      description: "Set EMAIL_TOKEN_ENCRYPTION_KEY before connecting Gmail. Northstar will not store OAuth tokens in plaintext.",
      ready: false,
      statusLine: "Gmail OAuth is configured, but encrypted token storage is not ready.",
      title: "Token encryption required"
    };
  }

  if (provider.status === "Reconnect required") {
    return {
      description: "Reconnect Gmail with the current read/send scopes before syncing inbox threads or sending explicit replies.",
      ready: false,
      statusLine: `Gmail is connected${provider.accountEmail ? ` as ${provider.accountEmail}` : ""}, but Full Inbox scopes are missing.`,
      title: "Reconnect Gmail for Full Inbox"
    };
  }

  if (!provider.syncAvailable) {
    return {
      description: "Connect Gmail with Full Inbox scopes, or keep using Relationship Inbox and manual email logging from CRM records.",
      ready: false,
      statusLine: "Gmail Full Inbox is not connected yet.",
      title: "Gmail is not connected"
    };
  }

  if (provider.status === "Sync issue") {
    return {
      description: "Gmail is connected, but the latest provider sync reported an issue. Review the redacted provider error and retry sync.",
      ready: true,
      statusLine: `Gmail Full Inbox is connected${provider.accountEmail ? ` as ${provider.accountEmail}` : ""}, with a sync issue to review.`,
      title: "Gmail sync needs attention"
    };
  }

  return {
    description: "Gmail Full Inbox is connected. Sync now to queue the background worker or refresh a selected thread from the inbox reader.",
    ready: true,
    statusLine: `Gmail Full Inbox is connected${provider.accountEmail ? ` as ${provider.accountEmail}` : ""}.`,
    title: "Gmail Full Inbox connected"
  };
}

function fullInboxEmptyStateCopy(provider: ProviderCard | undefined, threadCount: number) {
  if (threadCount > 0) {
    return {
      description: "Choose a synced Gmail thread to review stored messages, draft replies, classify, or create follow-ups.",
      title: "Choose an inbox thread"
    };
  }

  const readiness = gmailFullInboxReadiness(provider);
  if (!readiness.ready) {
    return {
      description: `${readiness.description} Relationship Inbox and manual email logging still work without a synced mailbox.`,
      title: readiness.title
    };
  }

  if (provider?.lastSyncAt) {
    return {
      description:
        "The latest Gmail sync did not store any inbox threads. Confirm the connected mailbox has recent inbox mail, then sync again or check the background worker.",
      title: "No Gmail threads stored yet"
    };
  }

  return {
    description:
      "Gmail is connected, but no inbox sync has completed yet. Use Sync Gmail inbox, then run the background worker so Northstar can store recent threads.",
    title: "Sync Gmail to populate Full Inbox"
  };
}

function formatProviderSyncStatusDetail(detail: string) {
  const queuedAt = detail.match(/^Queued (.+)$/)?.[1];
  if (queuedAt) return `Queued ${formatMaybeDate(queuedAt)}`;
  const completedAt = detail.match(/^Completed (.+)$/)?.[1];
  if (completedAt) return `Completed ${formatMaybeDate(completedAt)}`;
  const retryAt = detail.match(/^Retry scheduled (.+)$/)?.[1];
  if (retryAt) return `Retry scheduled ${formatMaybeDate(retryAt)}`;
  return detail;
}

function formatMaybeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDate(date);
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

function EmailInboxThreadList({
  activeThreadId,
  threads
}: {
  activeThreadId: string;
  threads: EmailInboxThreadSummary[];
}) {
  return (
    <div className="email-inbox-thread-list" aria-label="Synced inbox threads">
      {threads.map((thread) => {
        const href = emailInboxThreadHref(thread.id);
        return (
          <Link
            aria-current={thread.id === activeThreadId ? "page" : undefined}
            aria-label={`Open inbox thread ${thread.subject}`}
            className={thread.id === activeThreadId ? "email-inbox-thread-row active" : "email-inbox-thread-row"}
            href={href}
            key={thread.id}
            title={`Open inbox thread ${thread.subject}`}
          >
            <span className="email-inbox-thread-main">
              <span className="email-inbox-thread-subject">{thread.subject}</span>
              <span className="muted">
                {thread.latestMessage.direction === "INBOUND" ? thread.latestMessage.fromText : thread.latestMessage.toText} ·{" "}
                {formatDate(thread.latestAt)}
              </span>
              <span className="muted">{thread.linkedRecordLabel ?? "No linked CRM record"}</span>
            </span>
            <span className="email-inbox-thread-meta">
              {thread.isUnread ? <Badge>Unread</Badge> : <Badge>Read</Badge>}
              <Badge>{thread.messageCount === 1 ? "1 message" : `${thread.messageCount} messages`}</Badge>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function EmailInboxThreadDetail({
  aiReplyReadiness,
  draftTemplates,
  followUpDetails,
  smartLabelReadiness,
  thread,
  workspaceId
}: {
  aiReplyReadiness: EmailReplyAssistantReadiness;
  draftTemplates: DraftTemplate[];
  followUpDetails: Map<string, EmailPriorityFollowUpDetail>;
  smartLabelReadiness: EmailClassificationReadiness;
  thread: EmailInboxThreadSummary;
  workspaceId: string;
}) {
  const replyTarget =
    [...thread.messages].reverse().find((message) => message.provider === "GOOGLE_WORKSPACE" && message.direction === "INBOUND") ??
    [...thread.messages].reverse().find((message) => message.provider === "GOOGLE_WORKSPACE") ??
    null;
  return (
    <div className="email-inbox-thread-detail" aria-label={`Inbox thread ${thread.subject}`}>
      <div className="email-inbox-thread-header">
        <CompactTitleRow
          actions={
            <ActionGroup className="filter-actions" label={`${thread.subject} thread status`}>
              {thread.isUnread ? <Badge>Unread</Badge> : <Badge>Read</Badge>}
              <Badge>{formatEmailProvider(thread.provider)}</Badge>
              <Badge>{thread.messageCount === 1 ? "1 message" : `${thread.messageCount} messages`}</Badge>
              {thread.provider === "GOOGLE_WORKSPACE" ? (
                <form action={refreshGmailThreadFromEmailPageAction}>
                  <input name="threadId" type="hidden" value={thread.id} />
                  <button
                    aria-label={`Refresh Gmail thread ${thread.subject}`}
                    className="button-secondary button-compact"
                    title={`Refresh Gmail thread ${thread.subject}`}
                    type="submit"
                  >
                    Refresh thread
                  </button>
                </form>
              ) : null}
            </ActionGroup>
          }
          description={`${thread.linkedRecordLabel ?? "No linked CRM record"} · Latest ${formatDate(thread.latestAt)}`}
          title={thread.subject}
        />
        {replyTarget ? <GmailReplyComposer replyTarget={replyTarget} threadId={thread.id} /> : null}
      </div>
      <div className="email-command-list email-inbox-message-list">
        {thread.messages.map((message) => (
          <EmailLogCard
            aiReplyReadiness={aiReplyReadiness}
            draftTemplates={draftTemplates}
            emailLog={message}
            followUpDetail={followUpDetails.get(message.id)}
            key={message.id}
            smartLabelReadiness={smartLabelReadiness}
            workspaceId={workspaceId}
          />
        ))}
      </div>
    </div>
  );
}

function GmailReplyComposer({ replyTarget, threadId }: { replyTarget: EmailInboxThreadSummary["messages"][number]; threadId: string }) {
  return (
    <details className="email-draft-panel email-inbox-reply-panel">
      <summary>Send Gmail reply</summary>
      <p className="form-hint">
        Explicit send only. Northstar sends this reply through the connected Gmail account and logs the sent message.
      </p>
      <form action={sendGmailReplyFromEmailPageAction} className="email-follow-up-form">
        <input name="emailLogId" type="hidden" value={replyTarget.id} />
        <input name="threadId" type="hidden" value={threadId} />
        <label className="form-field form-field-wide">
          <span className="form-label">Reply body</span>
          <textarea name="body" required rows={7} />
        </label>
        <button
          aria-label={`Send Gmail reply to ${replyTarget.direction === "INBOUND" ? replyTarget.fromText : replyTarget.toText}`}
          className="button-primary button-compact"
          type="submit"
        >
          Send reply
        </button>
      </form>
    </details>
  );
}

function emailInboxThreadHref(threadId: string) {
  const params = new URLSearchParams({ thread: threadId });
  return `/email?${params.toString()}` as Route;
}

function oldestInboxMessageDate(threads: EmailInboxThreadSummary[]) {
  const timestamps = threads.flatMap((thread) => thread.messages.map((message) => message.occurredAt.getTime()));
  if (timestamps.length === 0) return null;
  return new Date(Math.min(...timestamps));
}

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
      <RelationshipInboxActionExplanationDetail explanation={explainer.actionExplanation} />
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

function RelationshipInboxActionExplanationDetail({ explanation }: { explanation: EmailPriorityActionExplanation }) {
  return (
    <section className="relationship-inbox-action-detail" aria-label="Why this action is recommended">
      <div className="relationship-inbox-evidence-detail-header">
        <div>
          <span className="relationship-inbox-explainer-label">Why this action?</span>
          <p>{explanation.headline}</p>
        </div>
        <Badge>{emailNextBestActionSeverityLabel(explanation.severity)}</Badge>
      </div>
      <p>{explanation.reason}</p>
      <div className="relationship-inbox-action-chain">
        <div>
          <span className="relationship-inbox-explainer-label">Signals</span>
          {explanation.contributingSignals.length > 0 ? (
            <ActionGroup className="filter-actions" label="Signals contributing to recommended action">
              {explanation.contributingSignals.map((signal) => (
                <Badge key={signal.key}>{signal.label}</Badge>
              ))}
            </ActionGroup>
          ) : (
            <p className="form-hint">No saved signal directly contributes; the recommendation is based on classification or CRM state.</p>
          )}
        </div>
        <div>
          <span className="relationship-inbox-explainer-label">CRM state</span>
          <p className="form-hint">{explanation.crmState.label}</p>
        </div>
        <div>
          <span className="relationship-inbox-explainer-label">Follow-up state</span>
          <p className="form-hint">
            {explanation.followUpState.label}
            {explanation.followUpState.source ? ` · ${emailFollowUpSourceLabel(explanation.followUpState.source)}` : ""}
            {explanation.followUpState.openCount > 0 ? ` · ${explanation.followUpState.openCount} open` : ""}
            {explanation.followUpState.completedCount > 0 ? ` · ${explanation.followUpState.completedCount} completed` : ""}
          </p>
        </div>
      </div>
      {explanation.contributingSignals.some((signal) => signal.excerpts.length > 0 || signal.reason) ? (
        <div className="relationship-inbox-action-signal-map">
          {explanation.contributingSignals.map((signal) => (
            <details className="relationship-inbox-evidence-drilldown" key={signal.key} open={signal.excerpts.length > 0}>
              <summary>
                <Badge>{signal.label}</Badge>
                <span>{signal.reason ?? "Saved signal contributed to the recommended action."}</span>
              </summary>
              {signal.excerpts.length > 0 ? (
                <div className="relationship-inbox-evidence-drilldown-body">
                  {signal.excerpts.map((excerpt) => (
                    <blockquote className="relationship-inbox-evidence-excerpt" key={`${signal.key}-${excerpt}`}>
                      {excerpt}
                    </blockquote>
                  ))}
                </div>
              ) : (
                <p className="form-hint">No signal-specific excerpt is saved for this action reason.</p>
              )}
            </details>
          ))}
        </div>
      ) : null}
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
    return `Gmail Full Inbox sync finished. Stored ${searchParams.created ?? "0"} new message${
      searchParams.created === "1" ? "" : "s"
    }; found ${searchParams.duplicates ?? "0"} duplicate.`;
  }
  if (searchParams?.emailConnection === "microsoft-synced") {
    return `Recent Microsoft mail sync finished. Imported ${searchParams.created ?? "0"} matched message${
      searchParams.created === "1" ? "" : "s"
    }; skipped ${searchParams.skipped ?? "0"} unmatched and ${searchParams.duplicates ?? "0"} duplicate.`;
  }
  if (searchParams?.emailConnection === "gmail-sync-error") {
    return "Gmail Full Inbox sync was not completed. Reconnect Gmail with Full Inbox scopes or check provider configuration.";
  }
  if (searchParams?.emailConnection === "gmail-sync-queued") {
    return "Gmail Full Inbox sync was queued. A background worker will refresh inbox threads using Gmail history when available, then recent inbox fallback if needed.";
  }
  if (searchParams?.emailConnection === "gmail-loaded-more") {
    return `Older Gmail messages loaded. Stored ${searchParams.created ?? "0"} new message${
      searchParams.created === "1" ? "" : "s"
    }; found ${searchParams.duplicates ?? "0"} duplicate.`;
  }
  if (searchParams?.emailConnection === "gmail-load-more-error") {
    return "Older Gmail messages were not loaded. Reconnect Gmail with Full Inbox scopes or try again.";
  }
  if (searchParams?.emailConnection === "gmail-thread-refreshed") {
    return `Gmail thread refreshed. Stored ${searchParams.created ?? "0"} new message${
      searchParams.created === "1" ? "" : "s"
    }; found ${searchParams.duplicates ?? "0"} duplicate.`;
  }
  if (searchParams?.emailConnection === "gmail-thread-refresh-error") {
    return "Gmail thread was not refreshed. Reconnect Gmail, choose a synced thread, or try again.";
  }
  if (searchParams?.emailConnection === "microsoft-sync-error") {
    return "Recent Microsoft mail sync was not completed. Reconnect Microsoft or check provider configuration.";
  }
  if (searchParams?.emailConnection === "gmail-reply-sent") {
    return "Gmail reply sent and logged to the synced thread.";
  }
  if (searchParams?.emailConnection === "gmail-reply-error") {
    return "Gmail reply was not sent. Reconnect Gmail, check the recipient, or try again.";
  }
  if (searchParams?.emailConnection === "gmail-disconnected") {
    return "Gmail disconnected. Encrypted OAuth tokens were removed; synced email logs remain available for review.";
  }
  if (searchParams?.emailConnection === "microsoft-disconnected") {
    return "Microsoft mail disconnected. Encrypted OAuth tokens were removed; synced email logs remain available for review.";
  }
  if (searchParams?.emailConnection === "email-disconnect-error") {
    return "Email connection was not disconnected. Refresh provider status and try again.";
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
