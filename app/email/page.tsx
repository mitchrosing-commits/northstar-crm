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
import { GmailSyncHealthDetails } from "@/components/gmail-sync-health-details";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { NorthstarAssistantPanel } from "@/components/northstar-assistant-panel";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatCard } from "@/components/stat-card";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import {
  aiReplyToneFromPreferences,
  buildEmailPriorityQueue,
  buildEmailPriorityQueueSummary,
  buildEmailCrmLinkReviewQueue,
  buildEmailCrmLinkReviewSummary,
  buildInboxAssistantContext,
  buildNorthstarAssistantInsight,
  buildEmailFollowUpDraftFromEmailLog,
  buildWorkInbox,
  buildLocalEmailLabelSuggestions,
  buildLocalEmailSmartClassification,
  emailClassificationReadiness,
  emailFollowUpStateLabel,
  emailReplyAssistantReadiness,
  getAiPreferences,
  listEmailCrmLinkSuggestions,
  listEmailConnectionProviderCards,
  listEmailInboxThreads,
  listEmailPriorityFollowUpDetails,
  listEmailLogs,
  listEmailTemplates,
  isGmailPartialSyncWarning,
  listGmailInboxAccounts,
  normalizeWorkInboxCrmFilter,
  normalizeWorkInboxImportanceFilter,
  normalizeWorkInboxPriorityFilter,
  normalizeWorkInboxSearch,
  normalizeWorkInboxSort,
  normalizeWorkInboxTab,
  normalizeEmailPriorityQueueFilter,
  normalizeEmailCrmLinkReviewFilter,
  readEmailSmartClassification,
} from "@/lib/services/crm";
import type { EmailClassificationReadiness } from "@/lib/services/email-classification-service";
import type {
  EmailLinkedFollowUpSummary,
  EmailPriorityActionExplanation,
  EmailPriorityFollowUpDetail,
  EmailPriorityNextBestAction,
  EmailPriorityQueueExplainer,
  EmailPriorityQueueEvidenceTrailItem,
} from "@/lib/services/email-priority-queue-service";
import type { EmailReplyAssistantReadiness } from "@/lib/services/email-reply-assistant-service";
import type {
  WorkInboxCrmFilter,
  WorkInboxImportanceFilter,
  WorkInboxItem,
  WorkInboxPriorityFilter,
  WorkInboxSort,
  WorkInboxTriageAction,
} from "@/lib/services/email-inbox-intelligence-service";
import type {
  EmailInboxThreadSummary,
  EmailSyncHealth,
  EmailSyncPreview,
  GmailInboxAccountSummary,
} from "@/lib/services/email-connection-service";
import type { EmailCrmLinkReviewItem, EmailCrmLinkSuggestion, EmailCrmLinkSuggestionResult } from "@/lib/services/email-service";
import {
  disconnectEmailProviderFromEmailPageAction,
  linkEmailLogToCrmRecordFromEmailPageAction,
  loadOlderGmailInboxFromEmailPageAction,
  refreshGmailThreadFromEmailPageAction,
  sendGmailReplyFromEmailPageAction,
  syncGmailInboxFromEmailPageAction,
  syncRecentMicrosoftFromEmailPageAction,
} from "./actions";
import {
  decodeEmailSyncReview,
  emailSyncReviewCookieName,
} from "./sync-review";

export const dynamic = "force-dynamic";

type EmailPageProps = {
  searchParams?: Promise<{
    created?: string;
    duplicates?: string;
    emailConnection?: string;
    account?: string;
    importance?: string;
    inbox?: string;
    messageSkips?: string;
    page?: string;
    pageSize?: string;
    crm?: string;
    crmLink?: string;
    priority?: string;
    q?: string;
    queued?: string;
    skipped?: string;
    sort?: string;
    syncError?: string;
    syncStatus?: string;
    syncWarning?: string;
    thread?: string;
    total?: string;
  }>;
};

export default async function EmailPage({ searchParams }: EmailPageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actor, user } = await getCurrentWorkspaceContext();
  const cookieStore = await cookies();
  const latestSyncReview = isSyncResult(resolvedSearchParams?.emailConnection)
    ? decodeEmailSyncReview(cookieStore.get(emailSyncReviewCookieName)?.value)
    : null;
  const [
    providers,
    recentEmailLogs,
    emailTemplates,
    northstarContext,
    aiPreferences,
    gmailAccounts,
  ] = await Promise.all([
    listEmailConnectionProviderCards(actor),
    listEmailLogs(actor, { limit: 25 }),
    listEmailTemplates(actor, { activeOnly: true }),
    buildInboxAssistantContext(actor),
    getAiPreferences(actor),
    listGmailInboxAccounts(actor),
  ]);
  const selectedInboxAccount = selectedGmailInboxAccount(
    resolvedSearchParams?.account,
    gmailAccounts,
  );
  const selectedInboxConnectionId =
    selectedInboxAccount === "all" ? null : selectedInboxAccount;
  const inboxThreads = await listEmailInboxThreads(actor, {
    connectionId: selectedInboxConnectionId,
    limit: null,
  });
  const northstarInsight = await buildNorthstarAssistantInsight(
    northstarContext,
    { preferences: aiPreferences },
  );
  const defaultAiReplyTone = aiReplyToneFromPreferences(aiPreferences);
  const oldestInboxCoverage = oldestInboxMessageCoverage({
    accounts: gmailAccounts,
    selectedAccount: selectedInboxAccount,
    threads: inboxThreads,
  });
  const inboxFollowUpDetails = await listEmailPriorityFollowUpDetails(
    actor,
    inboxThreads.flatMap((thread) => thread.messages),
  );
  const followUpDetails = await listEmailPriorityFollowUpDetails(
    actor,
    recentEmailLogs,
  );
  const gmailProvider = providers.find(
    (provider) => provider.provider === "GOOGLE_WORKSPACE",
  );
  const microsoftProvider = providers.find(
    (provider) => provider.provider === "MICROSOFT_365",
  );
  const imapProvider = providers.find(
    (provider) => provider.provider === "IMAP_SMTP",
  );
  const majorProviderCards = buildMajorProviderCards({
    gmailProvider,
    microsoftProvider,
  });
  const gmailReadiness = gmailFullInboxReadiness(gmailProvider);
  const fullInboxEmptyState = fullInboxEmptyStateCopy(
    gmailProvider,
    inboxThreads.length,
  );
  const gmailSyncProgress = gmailSyncProgressState({
    emailConnection: resolvedSearchParams?.emailConnection,
    skippedMessageFailures: numberParam(resolvedSearchParams?.messageSkips),
    provider: gmailProvider,
    showRequested: resolvedSearchParams?.syncStatus === "1",
    syncError: resolvedSearchParams?.syncError,
    syncWarning: resolvedSearchParams?.syncWarning,
    threadCount: inboxThreads.length,
  });
  const statusCopy = emailStatusCopy(resolvedSearchParams);
  const syncSummary = buildSyncSummary(
    resolvedSearchParams,
    latestSyncReview,
    majorProviderCards,
  );
  const aiReplyReadiness = emailReplyAssistantReadiness(process.env);
  const smartLabelReadiness = emailClassificationReadiness(process.env);
  const draftTemplates = emailTemplates.map((template) => ({
    body: template.body,
    id: template.id,
    name: template.name,
    subject: template.subject,
  }));
  const activeWorkInboxTab = normalizeWorkInboxTab(resolvedSearchParams?.inbox);
  const activeWorkInboxSearch = normalizeWorkInboxSearch(
    resolvedSearchParams?.q,
  );
  const activeWorkInboxPriority = normalizeWorkInboxPriorityFilter(
    resolvedSearchParams?.priority,
  );
  const activeWorkInboxCrm = normalizeWorkInboxCrmFilter(
    resolvedSearchParams?.crm,
  );
  const activeWorkInboxImportance = normalizeWorkInboxImportanceFilter(
    resolvedSearchParams?.importance,
  );
  const activeWorkInboxSort = normalizeWorkInboxSort(
    resolvedSearchParams?.sort,
  );
  const activeWorkInboxPageSize = normalizeInboxPageSize(
    resolvedSearchParams?.pageSize,
  );
  const activeWorkInboxPage = normalizeInboxPage(resolvedSearchParams?.page);
  const workInbox = buildWorkInbox({
    crmFilter: activeWorkInboxCrm,
    followUpDetails: inboxFollowUpDetails,
    importanceFilter: activeWorkInboxImportance,
    priorityFilter: activeWorkInboxPriority,
    preferences: aiPreferences,
    query: activeWorkInboxSearch,
    selectedTab: activeWorkInboxTab,
    sort: activeWorkInboxSort,
    threads: inboxThreads,
  });
  const inboxFreshness = inboxFreshnessState({
    accounts: gmailAccounts,
    provider: gmailProvider,
    selectedAccount: selectedInboxAccount,
    threadCount: workInbox.items.length,
  });
  const paginatedWorkInbox = paginateInboxItems(workInbox.visibleItems, {
    page: activeWorkInboxPage,
    pageSize: activeWorkInboxPageSize,
  });
  const currentInboxReturnHref = inboxAccountHref(selectedInboxAccount, {
    activeTab: activeWorkInboxTab,
    crmFilter: activeWorkInboxCrm,
    importanceFilter: activeWorkInboxImportance,
    page: paginatedWorkInbox.page,
    pageSize: activeWorkInboxPageSize,
    priorityFilter: activeWorkInboxPriority,
    query: activeWorkInboxSearch,
    sort: activeWorkInboxSort,
  });
  const selectedWorkInboxItem = resolvedSearchParams?.thread
    ? (workInbox.visibleItems.find(
        (item) => item.thread.id === resolvedSearchParams.thread,
      ) ?? null)
    : null;
  const selectedInboxThread = selectedWorkInboxItem?.thread ?? null;
  const selectedThreadWasRequested = Boolean(
    resolvedSearchParams?.thread && selectedInboxThread,
  );
  const selectedInboxFollowUpDetails = new Map<
    string,
    EmailPriorityFollowUpDetail
  >();
  for (const message of selectedInboxThread?.messages ?? []) {
    const detail = inboxFollowUpDetails.get(message.id);
    if (detail) selectedInboxFollowUpDetails.set(message.id, detail);
  }
  const attentionLogs = recentEmailLogs
    .filter((emailLog) => emailNeedsAttention(emailLog))
    .slice(0, 6);
  const activeInboxFilter = normalizeEmailPriorityQueueFilter(
    resolvedSearchParams?.inbox,
  );
  const priorityQueueSummary = buildEmailPriorityQueueSummary(recentEmailLogs);
  const allPriorityQueueItems = buildEmailPriorityQueue({
    emailLogs: recentEmailLogs,
    followUpDetails,
  });
  const priorityQueueItems = buildEmailPriorityQueue({
    emailLogs: recentEmailLogs,
    filter: activeInboxFilter,
    followUpDetails,
  });
  const priorityExplainersByEmailId = new Map(
    allPriorityQueueItems.map((item) => [item.emailLog.id, item.explainer]),
  );
  const currentEmailPageReturnHref = emailPageCurrentReturnHref(
    resolvedSearchParams,
  );
  const crmLinkSuggestions = await listEmailCrmLinkSuggestions(
    actor,
    recentEmailLogs,
  );
  const selectedThreadCrmLinkSuggestions = selectedInboxThread
    ? await listEmailCrmLinkSuggestions(actor, selectedInboxThread.messages)
    : new Map<string, EmailCrmLinkSuggestionResult>();
  const activeCrmLinkReviewFilter = normalizeEmailCrmLinkReviewFilter(
    resolvedSearchParams?.crmLink,
  );
  const crmLinkReviewSummary = buildEmailCrmLinkReviewSummary({
    emailLogs: recentEmailLogs,
    suggestions: crmLinkSuggestions,
  });
  const crmLinkReviewItems = buildEmailCrmLinkReviewQueue({
    emailLogs: recentEmailLogs,
    filter: activeCrmLinkReviewFilter,
    suggestions: crmLinkSuggestions,
  });
  const activeCrmLinkReviewLabel =
    crmLinkReviewSummary.find((item) => item.id === activeCrmLinkReviewFilter)
      ?.label ?? "All unlinked";
  const activeInboxFilterLabel =
    priorityQueueSummary.find((item) => item.id === activeInboxFilter)?.label ??
    "All priority";
  if (!gmailReadiness.ready) {
    return (
      <AppShell workspace={workspace}>
        <FullInboxSetupState
          gmailReadiness={gmailReadiness}
          provider={gmailProvider}
          loginEmail={user.email}
          statusCopy={statusCopy}
        />
      </AppShell>
    );
  }

  return (
    <AppShell workspace={workspace}>
      <section
        aria-label="Full Inbox synced Gmail mailbox"
        className={
          selectedThreadWasRequested
            ? "email-client-shell email-client-detail-shell"
            : "email-client-shell"
        }
        id="full-inbox"
      >
        {selectedThreadWasRequested &&
        selectedInboxThread &&
        selectedWorkInboxItem ? (
          <EmailInboxThreadDetail
            aiReplyReadiness={aiReplyReadiness}
            defaultAiReplyTone={defaultAiReplyTone}
            draftTemplates={draftTemplates}
            backHref={currentInboxReturnHref}
            followUpDetails={selectedInboxFollowUpDetails}
            insight={selectedWorkInboxItem}
            crmLinkSuggestions={selectedThreadCrmLinkSuggestions}
            returnTo={emailInboxThreadHref(selectedInboxThread.id, {
              account: selectedInboxAccount,
              activeTab: activeWorkInboxTab,
              crmFilter: activeWorkInboxCrm,
              importanceFilter: activeWorkInboxImportance,
              page: paginatedWorkInbox.page,
              pageSize: activeWorkInboxPageSize,
              priorityFilter: activeWorkInboxPriority,
              query: activeWorkInboxSearch,
              sort: activeWorkInboxSort,
            })}
            smartLabelReadiness={smartLabelReadiness}
            thread={selectedInboxThread}
            workspaceId={workspace.id}
          />
        ) : (
          <>
            <EmailClientHeader
              accounts={gmailAccounts}
              freshness={inboxFreshness}
              provider={gmailProvider}
              selectedAccount={selectedInboxAccount}
              syncProgress={gmailSyncProgress}
              returnTo={currentInboxReturnHref}
              threadCount={workInbox.items.length}
            />
            <WorkInboxToolbar
              activeTab={activeWorkInboxTab}
              accounts={gmailAccounts}
              crmFilter={activeWorkInboxCrm}
              freshness={inboxFreshness}
              importanceFilter={activeWorkInboxImportance}
              provider={gmailProvider}
              pageSize={activeWorkInboxPageSize}
              priorityFilter={activeWorkInboxPriority}
              priorityShortcuts={workInbox.priorityShortcuts}
              query={activeWorkInboxSearch}
              selectedAccount={selectedInboxAccount}
              sort={activeWorkInboxSort}
              syncProgress={gmailSyncProgress}
              returnTo={currentInboxReturnHref}
              tabs={workInbox.tabs}
            />
            {workInbox.visibleItems.length > 0 ? (
              <div className="email-inbox-layout inbox-main email-inbox-list-home">
                <div className="email-inbox-thread-list-shell inbox-thread-list-shell">
                  <InboxPaginationSummary
                    page={paginatedWorkInbox.page}
                    pageSize={activeWorkInboxPageSize}
                    totalCount={workInbox.visibleItems.length}
                  />
                  <WorkInboxThreadList
                    crmFilter={activeWorkInboxCrm}
                    importanceFilter={activeWorkInboxImportance}
                    items={paginatedWorkInbox.items}
                    page={paginatedWorkInbox.page}
                    pageSize={activeWorkInboxPageSize}
                    priorityFilter={activeWorkInboxPriority}
                    query={activeWorkInboxSearch}
                    selectedAccount={selectedInboxAccount}
                    sort={activeWorkInboxSort}
                    tab={activeWorkInboxTab}
                  />
                  <MailboxCoverageStrip
                    coverage={oldestInboxCoverage}
                    freshness={inboxFreshness}
                    provider={gmailProvider}
                    returnTo={currentInboxReturnHref}
                    selectedAccount={selectedInboxAccount}
                    threadCount={workInbox.items.length}
                  />
                  <WorkInboxPagination
                    activeTab={activeWorkInboxTab}
                    crmFilter={activeWorkInboxCrm}
                    importanceFilter={activeWorkInboxImportance}
                    page={paginatedWorkInbox.page}
                    pageSize={activeWorkInboxPageSize}
                    priorityFilter={activeWorkInboxPriority}
                    query={activeWorkInboxSearch}
                    selectedAccount={selectedInboxAccount}
                    sort={activeWorkInboxSort}
                    totalCount={workInbox.visibleItems.length}
                  />
                </div>
              </div>
            ) : workInbox.items.length > 0 ? (
              <WorkInboxFilteredEmptyState
                activeTab={activeWorkInboxTab}
                crmFilter={activeWorkInboxCrm}
                importanceFilter={activeWorkInboxImportance}
                priorityFilter={activeWorkInboxPriority}
                provider={gmailProvider}
                coverage={oldestInboxCoverage}
                pageSize={activeWorkInboxPageSize}
                query={activeWorkInboxSearch}
                returnTo={currentInboxReturnHref}
                selectedAccount={selectedInboxAccount}
                sort={activeWorkInboxSort}
              />
            ) : (
              <EmailInboxEmptyShell
                accountLabel={selectedInboxAccountLabel(
                  selectedInboxAccount,
                  gmailAccounts,
                )}
                emptyState={fullInboxEmptyState}
                provider={gmailProvider}
                returnTo={currentInboxReturnHref}
                selectedAccount={selectedInboxAccount}
              />
            )}
          </>
        )}
      </section>

      <details className="email-advanced-diagnostics section-separated">
        <summary>
          <span>Advanced diagnostics and legacy email tools</span>
          <Badge>{gmailProvider?.status ?? "Connected"}</Badge>
        </summary>
        <div className="email-advanced-diagnostics-body">
          <NorthstarAssistantPanel insight={northstarInsight} />

          <section
            className="panel inbox-workflow-map"
            aria-label="Inbox workflow map"
          >
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
            <PanelTitleRow
              actions={
                <Badge>{gmailProvider?.status ?? "Not configured"}</Badge>
              }
              title="Email Providers"
            />
            <EmailScopeCallout title="Sync boundaries">
              Gmail Full Inbox sync stores recent inbox messages and full
              readable bodies for review in Northstar. Replies are sent only
              from an explicit user action. Microsoft sync remains
              metadata-focused and CRM-matched for now.
            </EmailScopeCallout>
            {!gmailReadiness.ready ? (
              <EmptyState
                className="email-provider-empty"
                description={gmailReadiness.description}
                title={gmailReadiness.title}
              />
            ) : null}
            {statusCopy ? (
              <FormIntroCallout
                className="email-status-callout"
                title="Provider status"
              >
                {statusCopy}
              </FormIntroCallout>
            ) : null}
            <div className="provider-card-grid section-spaced">
              {majorProviderCards.map((provider) => {
                const providerActionsLabel = `${provider.name} provider actions`;
                const providerPrimaryActionLabel = `${provider.actionLabel}: ${provider.name} provider setup`;
                const providerSyncLabel =
                  provider.syncLabel ?? "Sync recent Gmail";
                const providerDisconnectLabel =
                  `Disconnect ${provider.name} account ${provider.accountEmail ?? ""}`.trim();
                const providerSyncActionLabel =
                  provider.provider === "MICROSOFT_365"
                    ? `${providerSyncLabel}: import recent matched ${provider.name} messages`
                    : `${providerSyncLabel}: store recent Gmail inbox threads`;
                const providerSyncMetricText = emailSyncMetricText(provider);
                const providerSyncHealth = provider.syncHealth ?? null;
                const providerSyncCanSubmit =
                  provider.provider !== "GOOGLE_WORKSPACE" ||
                  !providerSyncHealth ||
                  providerSyncHealth.canRetryNow;
                const providerSyncButtonLabel =
                  provider.provider === "GOOGLE_WORKSPACE" && providerSyncHealth
                    ? gmailSyncButtonLabel(providerSyncHealth, providerSyncLabel)
                    : providerSyncLabel;
                const showDisconnect = shouldShowProviderDisconnect(provider);
                return (
                  <div className="provider-card" key={provider.name}>
                    <CompactTitleRow
                      actions={<Badge>{provider.status}</Badge>}
                      title={provider.name}
                    />
                    <p>{provider.detail}</p>
                    {provider.accountEmail ? (
                      <p>Connected account: {provider.accountEmail}</p>
                    ) : null}
                    {provider.lastSyncAt ? (
                      <p>Last sync: {formatDate(provider.lastSyncAt)}</p>
                    ) : null}
                    {providerSyncMetricText ? <p>{providerSyncMetricText}</p> : null}
                    {provider.syncStatusLabel ? (
                      <p>
                        Sync status: {provider.syncStatusLabel}
                        {provider.syncStatusDetail
                          ? ` · ${formatProviderSyncStatusDetail(provider.syncStatusDetail)}`
                          : ""}
                      </p>
                    ) : null}
                    {providerSyncHealth ? (
                      <GmailSyncHealthDetails health={providerSyncHealth} />
                    ) : null}
                    {provider.lastError ? (
                      <p>Last sync issue: {provider.lastError}</p>
                    ) : null}
                    {provider.scopes.length > 0 ? (
                      <p>Scopes: {provider.scopes.join(", ")}</p>
                    ) : null}
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
                      <ActionGroup
                        className="filter-actions"
                        label={providerActionsLabel}
                      >
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
                            {provider.provider === "GOOGLE_WORKSPACE" ? (
                              <input
                                name="account"
                                type="hidden"
                                value={provider.connectionId ?? "all"}
                              />
                            ) : null}
                            {provider.provider === "GOOGLE_WORKSPACE" ? (
                              <input
                                name="returnTo"
                                type="hidden"
                                value={currentEmailPageReturnHref}
                              />
                            ) : null}
                            <button
                              aria-label={providerSyncActionLabel}
                              className="button-secondary button-compact"
                              disabled={!providerSyncCanSubmit}
                              title={providerSyncActionLabel}
                              type="submit"
                            >
                              {providerSyncButtonLabel}
                            </button>
                          </form>
                        ) : null}
                        {showDisconnect ? (
                          <form
                            action={disconnectEmailProviderFromEmailPageAction}
                          >
                            {provider.connectionId ? (
                              <input
                                name="connectionId"
                                type="hidden"
                                value={provider.connectionId}
                              />
                            ) : null}
                            <input
                              name="provider"
                              type="hidden"
                              value={provider.provider}
                            />
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
            <ConnectedGmailAccountsPanel
              accounts={gmailAccounts}
              returnTo={currentEmailPageReturnHref}
              selectedAccount={selectedInboxAccount}
            />
            {imapProvider ? (
              <EmailScopeCallout title="Provider roadmap">
                IMAP/SMTP is planned as a fallback for Yahoo Mail, Zoho Mail,
                Fastmail, iCloud, and non-Google hosting-provider email.
                Gmail-backed custom-domain mailboxes connect through Google
                Workspace.
              </EmailScopeCallout>
            ) : null}
          </section>

          {syncSummary ? (
            <section className="data-card section-separated">
              <PanelTitleRow
                actions={<Badge>{syncSummary.provider}</Badge>}
                title="Latest Sync Result"
              />
              <div className="stat-grid stat-grid-compact email-sync-metrics">
                <StatCard label="Fetched" value={syncSummary.totalFetched} />
                <StatCard label="Logged" value={syncSummary.created} />
                <StatCard label="Duplicates" value={syncSummary.duplicates} />
                <StatCard label="Unmatched" value={syncSummary.skipped} />
                {syncSummary.messageSkips > 0 ? (
                  <StatCard
                    label="Skipped messages"
                    value={syncSummary.messageSkips}
                  />
                ) : null}
              </div>
              <FormIntroCallout
                className="email-status-callout"
                title="Sync scope"
              >
                Last sync:{" "}
                {syncSummary.lastSyncAt
                  ? formatDate(syncSummary.lastSyncAt)
                  : "Just now"}
                . Synced emails are stored for inbox review. Gmail Full Inbox
                messages may be unlinked until they match or are attached to CRM
                records; Microsoft sync remains CRM-matched metadata.
              </FormIntroCallout>
              {syncSummary.totalFetched > 0 && syncSummary.created === 0 ? (
                <FormIntroCallout
                  className="email-status-callout email-sync-followup"
                  title="Next step"
                >
                  No matches yet — add contacts or create them from email so
                  future syncs can link messages to CRM timelines.
                </FormIntroCallout>
              ) : null}
            </section>
          ) : null}

          {latestSyncReview?.unmatchedPreviews.length ? (
            <section className="data-card section-separated">
              <PanelTitleRow
                actions={<Badge>Temporary</Badge>}
                title="Unmatched Email Review"
              />
              <EmailScopeCallout title="Review scope">
                These recent messages did not match existing contacts. Create a
                contact or lead, or ignore them for now. Northstar is not
                storing unmatched inbox history.
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

          <section
            aria-label="Unlinked stored email CRM review queue"
            className="data-card section-separated"
            id="unlinked-email-review"
          >
            <PanelTitleRow
              actions={
                <ActionGroup
                  className="filter-actions"
                  label="Unlinked email review counts"
                >
                  <Badge>
                    {crmLinkReviewSummary[0]?.count ?? 0} unlinked
                  </Badge>
                  <Badge>
                    {crmLinkReviewSummary[1]?.highConfidenceCount ?? 0} high
                    confidence
                  </Badge>
                </ActionGroup>
              }
              description="Work unlinked stored emails with deterministic CRM suggestions. Linking remains one email at a time."
              title="Unlinked Email Review"
            />
            <EmailScopeCallout title="Review-first linking">
              This queue uses exact emails, confirmed organization domains,
              existing CRM associations, and same-thread links only. It never
              creates records, auto-applies links, creates follow-ups, or guesses
              among ambiguous records.
            </EmailScopeCallout>
            <ActionGroup
              className="relationship-inbox-filter-bar"
              label="Unlinked email review filters"
            >
              {crmLinkReviewSummary.map((item) => (
                <Link
                  aria-current={
                    item.id === activeCrmLinkReviewFilter ? "page" : undefined
                  }
                  aria-label={`Show ${item.label} unlinked email review items`}
                  className={
                    item.id === activeCrmLinkReviewFilter
                      ? "button-primary button-compact"
                      : "button-secondary button-compact"
                  }
                  href={emailCrmLinkReviewFilterHref(
                    item.id,
                    resolvedSearchParams,
                  )}
                  key={item.id}
                  title={`Show ${item.label} unlinked email review items`}
                >
                  {item.label} ({item.count})
                </Link>
              ))}
            </ActionGroup>
            {crmLinkReviewItems.length > 0 ? (
              <div className="email-crm-link-review-list">
                {crmLinkReviewItems.map((item) => (
                  <EmailCrmLinkReviewQueueRow
                    item={item}
                    key={item.emailLog.id}
                    returnTo={currentEmailPageReturnHref}
                  />
                ))}
              </div>
            ) : (
              <InlineEmptyStateText>
                No {activeCrmLinkReviewLabel.toLowerCase()} emails in the
                current review set. Linked emails leave this queue
                automatically.
              </InlineEmptyStateText>
            )}
          </section>

          <section
            aria-label="Relationship Inbox CRM priority queue"
            className="data-card section-separated"
            id="relationship-inbox"
          >
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
              Relationship Inbox is the CRM action queue for stored email. Smart
              Labels are saved only after you classify a stored email. They are
              suggested relationship signals, not commands: Northstar does not
              create activities, notes, leads, or profile facts from viewing
              this queue.
            </EmailScopeCallout>
            <ActionGroup
              className="relationship-inbox-filter-bar"
              label="Relationship Inbox priority filters"
            >
              {priorityQueueSummary.map((item) => (
                <Link
                  aria-current={
                    item.id === activeInboxFilter ? "page" : undefined
                  }
                  aria-label={`Show ${item.label} Relationship Inbox emails`}
                  className={
                    item.id === activeInboxFilter
                      ? "button-primary button-compact"
                      : "button-secondary button-compact"
                  }
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
                  const reviewHref = emailCardHref(emailLog.id);
                  const draftHref = emailDraftReviewHref(emailLog.id);
                  const followUpHref = emailFollowUpReviewHref(emailLog.id);
                  const crmLinkSuggestion = crmLinkSuggestions.get(emailLog.id);
                  const actionHref = relationshipInboxActionHref(
                    item.nextBestAction,
                    { draftHref, followUpHref, reviewHref },
                  );
                  return (
                    <article
                      className="relationship-inbox-signal-row"
                      key={emailLog.id}
                    >
                      <CompactTitleRow
                        actions={<Badge>{item.priorityLabel}</Badge>}
                        description={`${emailLog.direction === "INBOUND" ? "From" : "To"} ${
                          emailLog.direction === "INBOUND"
                            ? (emailLog.fromText ?? "Not recorded")
                            : (emailLog.toText ?? "Not recorded")
                        } · ${formatDate(emailLog.occurredAt)}`}
                        title={emailLog.subject}
                      />
                      <ActionGroup
                        className="filter-actions"
                        label={`${emailLog.subject} relationship inbox smart labels`}
                      >
                        {item.labels.slice(0, 5).map((label) => (
                          <Badge key={label}>{label}</Badge>
                        ))}
                        {item.classification ? (
                          <Badge>
                            {Math.round(item.classification.confidence * 100)}%
                            confidence
                          </Badge>
                        ) : null}
                      </ActionGroup>
                      <div
                        aria-label={`${emailLog.subject} queue state`}
                        className="relationship-inbox-state-strip"
                      >
                        {item.linkedRecord ? (
                          <Link
                            className="relationship-inbox-state-link"
                            href={item.linkedRecord.href}
                          >
                            Linked: {item.linkedRecord.label}
                          </Link>
                        ) : (
                          <span>No linked CRM record</span>
                        )}
                        {!item.linkedRecord && crmLinkSuggestion?.primarySuggestion ? (
                          <span>
                            Suggested: {crmLinkSuggestion.primarySuggestion.label}
                          </span>
                        ) : null}
                        <span>{emailFollowUpStateLabel(item.followUpState)}</span>
                        <span>Next: {item.nextBestAction.label}</span>
                        {item.followUps.length > 1 ? (
                          <span>{item.followUps.length} linked follow-ups</span>
                        ) : null}
                      </div>
                      <RelationshipInboxQueueExplainer
                        explainer={item.explainer}
                        subject={emailLog.subject}
                      />
                      <EmailLinkedFollowUps
                        compact
                        followUps={item.followUps}
                        subject={emailLog.subject}
                        workspaceId={workspace.id}
                      />
                      <RelationshipInboxNextBestAction
                        action={item.nextBestAction}
                        actionExplanation={item.explainer.actionExplanation}
                        actionHref={actionHref}
                        subject={emailLog.subject}
                        workspaceId={workspace.id}
                      />
                      <p className="form-hint">
                        {item.classification?.summary ??
                          "No Smart Label saved yet."}
                      </p>
                      <ActionGroup
                        className="filter-actions"
                        label={`${emailLog.subject} relationship inbox actions`}
                      >
                        <Link
                          aria-label={`Review email card for ${emailLog.subject}`}
                          className="button-secondary button-compact"
                          href={reviewHref}
                          title={`Review email card for ${emailLog.subject}`}
                        >
                          Review
                        </Link>
                        {!item.linkedRecord &&
                        (crmLinkSuggestion?.primarySuggestion ||
                          crmLinkSuggestion?.alternativeSuggestions.length) ? (
                          <Link
                            aria-label={`Review CRM link suggestions for ${emailLog.subject}`}
                            className="button-secondary button-compact"
                            href={reviewHref}
                            title={`Review CRM link suggestions for ${emailLog.subject}`}
                          >
                            Review link
                          </Link>
                        ) : null}
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
                          href={draftHref}
                          title={`Draft AI reply for email ${emailLog.subject}`}
                        >
                          Draft reply
                        </Link>
                        <Link
                          aria-label={`Create or review follow-up for email ${emailLog.subject}`}
                          className="button-secondary button-compact"
                          href={item.followUps[0]?.href ?? followUpHref}
                          title={`Create or review follow-up for email ${emailLog.subject}`}
                        >
                          {item.followUps.length > 0
                            ? "Open follow-up"
                            : "Review follow-up"}
                        </Link>
                      </ActionGroup>
                    </article>
                  );
                })}
              </div>
            ) : (
              <InlineEmptyStateText>
                No {activeInboxFilterLabel.toLowerCase()} emails in the current
                Relationship Inbox set. Classify stored emails below or clear
                the queue filter.
              </InlineEmptyStateText>
            )}
          </section>

          {attentionLogs.length > 0 ? (
            <section className="data-card section-separated">
              <PanelTitleRow
                actions={<Badge>{attentionLogs.length} need attention</Badge>}
                title="Suggested Follow-ups"
              />
              <div className="email-command-list">
                {attentionLogs.map((emailLog) => (
                  <EmailLogCard
                    aiReplyReadiness={aiReplyReadiness}
                    defaultAiReplyTone={defaultAiReplyTone}
                    draftTemplates={draftTemplates}
                    emailLog={emailLog}
                    key={emailLog.id}
                    followUpDetail={followUpDetails.get(emailLog.id)}
                    crmLinkSuggestion={crmLinkSuggestions.get(emailLog.id)}
                    smartLabelReadiness={smartLabelReadiness}
                    priorityExplainer={priorityExplainersByEmailId.get(
                      emailLog.id,
                    )}
                    returnTo={currentEmailPageReturnHref}
                    workspaceId={workspace.id}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="data-card">
            <PanelTitleRow
              actions={<Badge>{recentEmailLogs.length} shown</Badge>}
              title="Stored Email History"
            />
            {recentEmailLogs.length > 0 ? (
              <div className="email-command-list">
                {recentEmailLogs.map((emailLog) => (
                  <EmailLogCard
                    aiReplyReadiness={aiReplyReadiness}
                    defaultAiReplyTone={defaultAiReplyTone}
                    draftTemplates={draftTemplates}
                    emailLog={emailLog}
                    key={emailLog.id}
                    followUpDetail={followUpDetails.get(emailLog.id)}
                    crmLinkSuggestion={crmLinkSuggestions.get(emailLog.id)}
                    smartLabelReadiness={smartLabelReadiness}
                    priorityExplainer={priorityExplainersByEmailId.get(
                      emailLog.id,
                    )}
                    returnTo={currentEmailPageReturnHref}
                    showEvidenceAnchor
                    workspaceId={workspace.id}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                description="Synced Gmail messages and reviewed manual fallback logs appear here. If Full Inbox cannot reach a message yet, use the manual logging fallback from the related CRM record."
                title="No email activity yet"
              />
            )}
            <details className="manual-email-legacy-fallback">
              <summary>
                <span>Manual logging / legacy fallback</span>
                <Badge>Fallback</Badge>
              </summary>
              <p>
                Manual email logging stays available on deal, contact,
                organization, and lead records for emails that are not available
                through synced Gmail Full Inbox yet. Prefer Full Inbox sync for
                mailbox-backed messages.
              </p>
              <p className="form-hint">
                TODO: Remove or further de-emphasize manual logging after Gmail
                Full Inbox is proven in boss testing.
              </p>
            </details>
          </section>
        </div>
      </details>
    </AppShell>
  );
}

function EmailScopeCallout({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <FormIntroCallout className="email-scope-callout" title={title}>
      {children}
    </FormIntroCallout>
  );
}

function EmailClientHeader({
  accounts,
  freshness,
  provider,
  returnTo,
  selectedAccount,
  syncProgress,
  threadCount,
}: {
  accounts: GmailInboxAccountSummary[];
  freshness: InboxFreshness;
  provider: ProviderCard | undefined;
  returnTo: Route;
  selectedAccount: string;
  syncProgress: GmailSyncProgress;
  threadCount: number;
}) {
  const accountCountLabel =
    accounts.length === 1
      ? "1 inbox connected"
      : `${accounts.length} inboxes connected`;
  const selectedAccountLabel = selectedInboxAccountLabel(
    selectedAccount,
    accounts,
  );
  return (
    <header className="email-client-header">
      <div className="email-client-title-block">
        <span className="eyebrow">Communication</span>
        <h1>Inbox</h1>
        <p>
          {freshness.label} · {accountCountLabel} ·{" "}
          {threadCount > 0
            ? `Showing ${threadCount} stored synced threads`
            : "No synced messages yet"}{" "}
          · {selectedAccountLabel}
        </p>
      </div>
      <ActionGroup
        className="email-client-header-actions"
        label="Inbox actions"
      >
        <Badge>{syncProgress.statusLabel}</Badge>
        <FullInboxPrimaryAction
          provider={provider}
          returnTo={returnTo}
          selectedAccount={selectedAccount}
        />
        <Link
          aria-label="Connect another Gmail or Google Workspace inbox"
          className="button-secondary button-compact"
          href={emailConnectHrefWithReturnTo(
            "/api/email-connections/google/connect",
            returnTo,
          )}
          title="Connect another Gmail or Google Workspace inbox"
        >
          Add inbox
        </Link>
      </ActionGroup>
    </header>
  );
}

function FullInboxSetupState({
  gmailReadiness,
  loginEmail,
  provider,
  statusCopy,
}: {
  gmailReadiness: ReturnType<typeof gmailFullInboxReadiness>;
  loginEmail: string;
  provider: ProviderCard | undefined;
  statusCopy: string | null;
}) {
  return (
    <section
      className="email-setup-panel section-separated"
      aria-label="Connect Gmail for Northstar Inbox"
    >
      <PanelTitleRow
        actions={<FullInboxPrimaryAction provider={provider} />}
        description="Bring your work inbox into Northstar to summarize emails, draft replies, and link messages to CRM records."
        title="Connect Gmail or Google Workspace"
      />
      <div className="email-setup-grid">
        <div>
          <h3>Suggested: {loginEmail}</h3>
          <p>
            You can connect your login email or choose a different Google
            account.
          </p>
          <p className="form-hint">
            Northstar will suggest your login email first, but you can connect
            any Gmail or Google Workspace inbox you have access to.
          </p>
          <p className="form-hint">
            Northstar asks for read access to sync messages and send access only
            when you explicitly send a reply.
          </p>
        </div>
        <div>
          <h3>Status</h3>
          <p>{gmailReadiness.description}</p>
        </div>
      </div>
      {statusCopy ? (
        <FormIntroCallout
          className="email-status-callout"
          title="Connection status"
        >
          {statusCopy}
        </FormIntroCallout>
      ) : null}
    </section>
  );
}

function AdvancedEmailDiagnostics({
  gmailSyncProgress,
  provider,
}: {
  gmailSyncProgress: GmailSyncProgress;
  provider: ProviderCard | undefined;
}) {
  return (
    <details className="email-advanced-diagnostics section-separated">
      <summary>
        <span>Advanced diagnostics</span>
        <Badge>{gmailSyncProgress.statusLabel}</Badge>
      </summary>
      <div className="email-advanced-diagnostics-body">
        <GmailSyncProgressPanel
          progress={gmailSyncProgress}
          provider={provider}
        />
        <InboxAutoSyncReadinessNote />
      </div>
    </details>
  );
}

function InboxAutoSyncReadinessNote() {
  return (
    <section
      aria-label="Inbox auto-sync readiness"
      className="inbox-auto-sync-readiness"
    >
      <CompactTitleRow
        actions={<Badge>Job-backed refresh</Badge>}
        title="Inbox auto-sync readiness"
      />
      <p>
        Northstar uses the background job path for conservative Gmail refresh:
        account-aware cadence, per-account throttling, job dedupe, bounded
        history windows, and sanitized provider errors. Sync this inbox remains
        available as an explicit fallback.
      </p>
      <p>
        High-priority dashboard alert eligibility is prepared from deterministic
        Inbox intelligence, but this page does not create notifications or
        mutate CRM records from sync freshness alone.
      </p>
    </section>
  );
}

function WorkInboxToolbar({
  activeTab,
  accounts,
  crmFilter,
  freshness,
  importanceFilter,
  pageSize,
  provider,
  priorityFilter,
  priorityShortcuts,
  query,
  returnTo,
  selectedAccount,
  sort,
  syncProgress,
  tabs,
}: {
  activeTab: string;
  accounts: GmailInboxAccountSummary[];
  crmFilter: WorkInboxCrmFilter;
  freshness: InboxFreshness;
  importanceFilter: WorkInboxImportanceFilter;
  pageSize: number;
  provider: ProviderCard | undefined;
  priorityFilter: WorkInboxPriorityFilter;
  priorityShortcuts: Array<{
    count: number;
    href: Route;
    id: string;
    label: string;
    priorityFilter: WorkInboxPriorityFilter;
    tabId: string;
  }>;
  query: string;
  returnTo: Route;
  selectedAccount: string;
  sort: WorkInboxSort;
  syncProgress: GmailSyncProgress;
  tabs: Array<{ count: number; href: Route; id: string; label: string }>;
}) {
  const accountOptionsVisible = accounts.length > 1;
  return (
    <div className="work-inbox-toolbar">
      <div className="work-inbox-account-row">
        <div>
          <span className="relationship-inbox-explainer-label">Viewing</span>
          <strong>
            {selectedInboxAccountLabel(selectedAccount, accounts)}
          </strong>
        </div>
        {accountOptionsVisible ? (
          <ActionGroup
            className="work-inbox-tabs"
            label="Inbox account selector"
          >
            <Link
              aria-current={selectedAccount === "all" ? "page" : undefined}
              className={
                selectedAccount === "all"
                  ? "button-primary button-compact"
                  : "button-secondary button-compact"
              }
              href={inboxAccountHref("all", {
                activeTab,
                crmFilter,
                importanceFilter,
                pageSize,
                priorityFilter,
                query,
                sort,
              })}
            >
              Unified inbox
            </Link>
            {accounts.map((account) => (
              <Link
                aria-current={
                  selectedAccount === account.connectionId ? "page" : undefined
                }
                className={
                  selectedAccount === account.connectionId
                    ? "button-primary button-compact"
                    : "button-secondary button-compact"
                }
                href={inboxAccountHref(account.connectionId, {
                  activeTab,
                  crmFilter,
                  importanceFilter,
                  pageSize,
                  priorityFilter,
                  query,
                  sort,
                })}
                key={account.connectionId}
                title={`View ${account.accountEmail ?? account.connectionRef}`}
              >
                {account.accountEmail ?? account.connectionRef}
              </Link>
            ))}
          </ActionGroup>
        ) : (
          <Badge>
            {accounts[0]?.accountEmail ??
              provider?.accountEmail ??
              "No connected inbox"}
          </Badge>
        )}
      </div>
      <ActionGroup className="work-inbox-tabs" label="Work inbox categories">
        {tabs.map((tab) => (
          <Link
            aria-current={tab.id === activeTab ? "page" : undefined}
            className={
              tab.id === activeTab
                ? "button-primary button-compact"
                : "button-secondary button-compact"
            }
            href={appendInboxToolbarParams(tab.href, {
              account: selectedAccount,
              pageSize,
            })}
            key={tab.id}
            title={`Show ${tab.label} emails`}
          >
            {tab.label} ({tab.count})
          </Link>
        ))}
      </ActionGroup>
      <ActionGroup
        className="work-inbox-priority-shortcuts"
        label="Inbox priority and signal filters"
      >
        {priorityShortcuts.map((shortcut) => {
          const active =
            activeTab === shortcut.tabId &&
            priorityFilter === shortcut.priorityFilter;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "button-primary button-compact"
                  : "button-secondary button-compact"
              }
              href={appendInboxToolbarParams(shortcut.href, {
                account: selectedAccount,
                pageSize,
              })}
              key={shortcut.id}
              title={`Show ${shortcut.label} emails`}
            >
              {shortcut.label} ({shortcut.count})
            </Link>
          );
        })}
      </ActionGroup>
      <form action="/email" className="work-inbox-filter-form">
        <input name="account" type="hidden" value={selectedAccount} />
        <input name="inbox" type="hidden" value={activeTab} />
        <input name="pageSize" type="hidden" value={pageSize} />
        <label>
          <span>Search</span>
          <input
            aria-label="Search synced inbox"
            defaultValue={query}
            name="q"
            placeholder="Sender, subject, body, tag"
            type="search"
          />
        </label>
        <label>
          <span>Priority</span>
          <select
            aria-label="Filter inbox by priority"
            defaultValue={priorityFilter}
            name="priority"
          >
            <option value="all">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          <span>CRM</span>
          <select
            aria-label="Filter inbox by CRM link state"
            defaultValue={crmFilter}
            name="crm"
          >
            <option value="all">Any CRM state</option>
            <option value="linked">Linked</option>
            <option value="unlinked">Unlinked</option>
          </select>
        </label>
        <label>
          <span>Importance</span>
          <select
            aria-label="Filter unimportant inbox messages"
            defaultValue={importanceFilter}
            name="importance"
          >
            <option value="all">Show all</option>
            <option value="hide-unimportant">Hide unimportant</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select
            aria-label="Sort synced inbox"
            defaultValue={sort}
            name="sort"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="unread">Unread first</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        <button className="button-secondary button-compact" type="submit">
          Apply
        </button>
        {query ||
        priorityFilter !== "all" ||
        crmFilter !== "all" ||
        importanceFilter !== "all" ||
        sort !== "newest" ? (
          <Link
            className="button-secondary button-compact"
            href={inboxAccountHref(selectedAccount, { activeTab, pageSize })}
          >
            Clear
          </Link>
        ) : null}
      </form>
      <InboxFreshnessStrip
        freshness={freshness}
        provider={provider}
        returnTo={returnTo}
        selectedAccount={selectedAccount}
        syncProgress={syncProgress}
      />
    </div>
  );
}

function InboxFreshnessStrip({
  freshness,
  provider,
  returnTo,
  selectedAccount,
  syncProgress,
}: {
  freshness: InboxFreshness;
  provider: ProviderCard | undefined;
  returnTo: Route;
  selectedAccount: string;
  syncProgress: GmailSyncProgress;
}) {
  return (
    <div
      aria-label="Inbox freshness"
      className={`work-inbox-sync-strip inbox-freshness-strip inbox-freshness-${freshness.tone}`}
    >
      <Badge>{syncProgress.statusLabel}</Badge>
      <Badge>{freshness.label}</Badge>
      <span>
        <strong>{freshness.accountLabel}</strong> · {freshness.detail}
      </span>
      <FullInboxPrimaryAction
        provider={provider}
        returnTo={returnTo}
        selectedAccount={selectedAccount}
      />
    </div>
  );
}

function MailboxCoverageStrip({
  coverage,
  freshness,
  provider,
  returnTo,
  selectedAccount,
  threadCount,
}: {
  coverage: InboxCoverage;
  freshness: InboxFreshness;
  provider: ProviderCard | undefined;
  returnTo: Route;
  selectedAccount: string;
  threadCount: number;
}) {
  const selectedLabel =
    selectedAccount === "all" ? "Unified Inbox" : coverage.loadOlderAccountLabel;
  return (
    <div className="mailbox-coverage-strip" aria-label="Mailbox coverage">
      <div>
        <strong>Synced history</strong>
        <span>
          {selectedLabel} ·{" "}
          {threadCount === 1
            ? "1 stored thread"
            : `${threadCount} stored threads`}{" "}
          ·{" "}
          {coverage.viewLastSyncAt
            ? `Last sync ${formatDate(coverage.viewLastSyncAt)}`
            : "Not synced yet"}
          {coverage.oldestStoredAt
            ? ` · Oldest stored ${formatDate(coverage.oldestStoredAt)}`
            : ""}
        </span>
        <span className="mailbox-freshness-note">
          {freshness.detail}{" "}
          {selectedAccount === "all" && coverage.loadOlderAccountId
            ? `Load older targets ${coverage.loadOlderAccountLabel}, the inbox with the oldest stored message.`
            : "Load older keeps refreshes bounded to stored Gmail history."}
        </span>
      </div>
      <LoadOlderGmailHistoryAction
        coverage={coverage}
        provider={provider}
        returnTo={returnTo}
        selectedAccount={selectedAccount}
      />
    </div>
  );
}

function LoadOlderGmailHistoryAction({
  coverage,
  provider,
  returnTo,
  selectedAccount,
}: {
  coverage: InboxCoverage;
  provider: ProviderCard | undefined;
  returnTo: Route;
  selectedAccount: string;
}) {
  const accountLabel = coverage.loadOlderAccountLabel;
  if (
    !provider?.syncAvailable ||
    !coverage.oldestStoredAt ||
    !coverage.loadOlderAccountId
  ) {
    return (
      <span className="form-hint">
        Sync Gmail to store mailbox history, then load older messages in bounded
        batches.
      </span>
    );
  }

  return (
    <form
      action={loadOlderGmailInboxFromEmailPageAction}
      className="email-inbox-load-more"
    >
      <input
        name="account"
        type="hidden"
        value={coverage.loadOlderAccountId}
      />
      <input
        name="before"
        type="hidden"
        value={coverage.oldestStoredAt.toISOString()}
      />
      <input name="returnTo" type="hidden" value={returnTo} />
      <button
        aria-label={`Load older Gmail inbox messages for ${accountLabel}`}
        className="button-secondary button-compact"
        title={`Load older Gmail inbox messages for ${accountLabel}`}
        type="submit"
      >
        Load older messages
      </button>
      <span className="form-hint">
        {selectedAccount === "all"
          ? `Unified Inbox will load older history for ${accountLabel}, the account with the oldest stored message.`
          : `Loads ${accountLabel} messages before ${formatDate(coverage.oldestStoredAt)}.`}
      </span>
    </form>
  );
}

function InboxPaginationSummary({
  page,
  pageSize,
  totalCount,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
}) {
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalCount, page * pageSize);
  return (
    <div className="inbox-pagination-summary">
      <span>
        {totalCount === 0
          ? "Showing 0 synced emails"
          : `Showing ${start}-${end} of ${totalCount} synced emails`}
      </span>
    </div>
  );
}

function WorkInboxPagination({
  activeTab,
  crmFilter,
  importanceFilter,
  page,
  pageSize,
  priorityFilter,
  query,
  selectedAccount,
  sort,
  totalCount,
}: {
  activeTab: string;
  crmFilter: WorkInboxCrmFilter;
  importanceFilter: WorkInboxImportanceFilter;
  page: number;
  pageSize: number;
  priorityFilter: WorkInboxPriorityFilter;
  query: string;
  selectedAccount: string;
  sort: WorkInboxSort;
  totalCount: number;
}) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(pageCount, page + 1);
  const paginationLabel = `Inbox pagination. Page ${page} of ${pageCount}.`;
  const pageSizeOptions = [25, 50, 100];

  return (
    <div className="inbox-pagination" aria-label={paginationLabel}>
      <ActionGroup className="filter-actions" label="Inbox page controls">
        <Link
          aria-disabled={page <= 1 ? "true" : undefined}
          className={
            page <= 1
              ? "button-secondary button-compact button-disabled"
              : "button-secondary button-compact"
          }
          href={inboxAccountHref(selectedAccount, {
            activeTab,
            crmFilter,
            importanceFilter,
            page: previousPage,
            pageSize,
            priorityFilter,
            query,
            sort,
          })}
        >
          Previous
        </Link>
        <Badge>
          Page {page} of {pageCount}
        </Badge>
        <Link
          aria-disabled={page >= pageCount ? "true" : undefined}
          className={
            page >= pageCount
              ? "button-secondary button-compact button-disabled"
              : "button-secondary button-compact"
          }
          href={inboxAccountHref(selectedAccount, {
            activeTab,
            crmFilter,
            importanceFilter,
            page: nextPage,
            pageSize,
            priorityFilter,
            query,
            sort,
          })}
        >
          Next
        </Link>
      </ActionGroup>
      <ActionGroup className="filter-actions" label="Inbox page size">
        {pageSizeOptions.map((option) => (
          <Link
            aria-current={option === pageSize ? "page" : undefined}
            className={
              option === pageSize
                ? "button-primary button-compact"
                : "button-secondary button-compact"
            }
            href={inboxAccountHref(selectedAccount, {
              activeTab,
              crmFilter,
              importanceFilter,
              page: 1,
              pageSize: option,
              priorityFilter,
              query,
              sort,
            })}
            key={option}
          >
            {option}
          </Link>
        ))}
      </ActionGroup>
    </div>
  );
}

function WorkInboxThreadList({
  crmFilter,
  importanceFilter,
  items,
  page,
  pageSize,
  priorityFilter,
  query,
  selectedAccount,
  sort,
  tab,
}: {
  crmFilter: WorkInboxCrmFilter;
  importanceFilter: WorkInboxImportanceFilter;
  items: WorkInboxItem[];
  page: number;
  pageSize: number;
  priorityFilter: WorkInboxPriorityFilter;
  query: string;
  selectedAccount: string;
  sort: WorkInboxSort;
  tab: string;
}) {
  if (items.length === 0) {
    return (
      <div className="inbox-thread-list" aria-label="Work inbox threads">
        <EmptyState
          className="email-inbox-empty-rail"
          description="No synced threads match this category yet. Try All or sync Gmail again."
          title="No messages in this category"
          titleLevel="h3"
        />
      </div>
    );
  }

  return (
    <div className="inbox-thread-list" aria-label="Work inbox threads">
      {items.map((item) => {
        const thread = item.thread;
        const sender =
          thread.latestMessage.direction === "INBOUND"
            ? thread.latestMessage.fromText
            : thread.latestMessage.toText;
        const visibleTags = item.tags.slice(0, 3);
        const hiddenTagCount = Math.max(
          0,
          item.tags.length - visibleTags.length,
        );
        return (
          <Link
            aria-label={`Open inbox thread ${thread.subject}. ${priorityLevelLabel(item.priorityLevel)}. ${item.detectedIntent}. ${item.whyItMatters}`}
            className={`inbox-thread-row${item.waitingOnCustomer ? " inbox-thread-row-waiting" : ""}`}
            href={emailInboxThreadHref(thread.id, {
              account: selectedAccount,
              activeTab: tab,
              crmFilter,
              importanceFilter,
              page,
              pageSize,
              priorityFilter,
              query,
              sort,
            })}
            key={thread.id}
            title={`${priorityLevelLabel(item.priorityLevel)} · ${item.detectedIntent} · ${item.whyItMatters}`}
          >
            <span className="inbox-thread-status" aria-hidden="true">
              {thread.isUnread ? (
                <span className="inbox-thread-unread-dot" />
              ) : null}
            </span>
            <span className="inbox-thread-sender">
              {sender || "Unknown sender"}
            </span>
            <span
              className="inbox-thread-tags"
              aria-label={`${thread.subject} inbox tags`}
            >
              {visibleTags.map((tag) => (
                <Badge className="badge inbox-thread-tag" key={tag}>
                  {tag}
                </Badge>
              ))}
              {hiddenTagCount > 0 ? (
                <Badge className="badge inbox-thread-tag">
                  +{hiddenTagCount}
                </Badge>
              ) : null}
            </span>
            <span className="inbox-thread-subject-line">
              <span className="inbox-thread-subject">{thread.subject}</span>
              <span className="inbox-thread-preview">
                {item.summary.summary}
              </span>
            </span>
            <span className="inbox-thread-meta">
              {item.isUnimportant ? (
                <Badge className="badge inbox-thread-importance">
                  Unimportant
                </Badge>
              ) : null}
              {thread.accountEmail ? (
                <span className="inbox-thread-account">
                  {thread.accountEmail}
                </span>
              ) : null}
              <span
                aria-label={priorityLevelLabel(item.priorityLevel)}
                className={`inbox-thread-priority inbox-thread-priority-${item.priorityLevel}`}
                title={priorityLevelLabel(item.priorityLevel)}
              />
              <span className="inbox-thread-priority-copy">
                {compactPriorityLevelLabel(item.priorityLevel)}
              </span>
              <time dateTime={thread.latestAt.toISOString()}>
                {formatInboxThreadDate(thread.latestAt)}
              </time>
            </span>
            {item.waitingOnCustomer ? (
              <span
                aria-label={`${item.waitingOnCustomer.waitLabel}. Latest outbound ${formatDate(item.waitingOnCustomer.latestOutboundAt)}. ${item.waitingOnCustomer.reason}`}
                className="inbox-thread-waiting"
              >
                <Badge className="badge inbox-thread-waiting-badge">
                  Waiting on customer
                </Badge>
                <span>{item.waitingOnCustomer.waitLabel}</span>
                <span>
                  Latest outbound{" "}
                  {formatInboxThreadDate(item.waitingOnCustomer.latestOutboundAt)}
                </span>
                <span>
                  {item.relatedRecordLabel ?? "No linked CRM record"}
                </span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

function formatInboxThreadDate(value: Date) {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const time = value.getTime();
  if (time >= startOfToday) {
    return value.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (time >= startOfYesterday) return "Yesterday";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function WorkInboxFilteredEmptyState({
  activeTab,
  coverage,
  crmFilter,
  importanceFilter,
  pageSize,
  priorityFilter,
  provider,
  query,
  returnTo,
  selectedAccount,
  sort,
}: {
  activeTab: string;
  coverage: InboxCoverage;
  crmFilter: WorkInboxCrmFilter;
  importanceFilter: WorkInboxImportanceFilter;
  pageSize: number;
  priorityFilter: WorkInboxPriorityFilter;
  provider: ProviderCard | undefined;
  query: string;
  returnTo: Route;
  selectedAccount: string;
  sort: WorkInboxSort;
}) {
  const filterLabels = activeInboxFilterLabels({
    activeTab,
    crmFilter,
    importanceFilter,
    priorityFilter,
    query,
    sort,
  });
  const queueGuidance = workInboxFilterGuidance(activeTab, priorityFilter);
  const emptyDescription =
    importanceFilter === "hide-unimportant"
      ? `Hide unimportant is on, so locally classified low-value messages are hidden before the list is shown. ${queueGuidance.description} Show all, clear filters, or load older stored history for this inbox.`
      : query
        ? `No stored synced Gmail rows match this search and filter set. ${queueGuidance.description} Clear the search, change filters, or load older stored history for this inbox.`
        : `${queueGuidance.description} Stored synced Gmail exists for this inbox, but the current tab or filters hide every row. Clear filters, switch tabs, or load older stored history.`;
  return (
    <section
      className="email-inbox-empty-state email-inbox-empty-detail"
      aria-label="No matching inbox messages"
    >
      <EmptyState
        actions={
          <ActionGroup
            className="filter-actions"
            label="Filtered inbox empty actions"
          >
            <Link
              className="button-primary button-compact"
              href={inboxAccountHref(selectedAccount, { activeTab, pageSize })}
            >
              Clear filters
            </Link>
            <LoadOlderGmailHistoryAction
              coverage={coverage}
              provider={provider}
              returnTo={returnTo}
              selectedAccount={selectedAccount}
            />
            <FullInboxPrimaryAction
              provider={provider}
              returnTo={returnTo}
              selectedAccount={selectedAccount}
            />
          </ActionGroup>
        }
        actionsLabel="Filtered inbox empty actions"
        description={emptyDescription}
        title={queueGuidance.title}
        titleLevel="h3"
      >
        {filterLabels.length > 0 ? (
          <ActionGroup
            className="filter-actions inbox-empty-filter-chips"
            label="Active inbox filters"
          >
            {filterLabels.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </ActionGroup>
        ) : null}
        <p className="form-hint">
          Older Gmail history is loaded only when you choose it; viewing this
          empty state does not send email, mutate Gmail, or change CRM records.
        </p>
      </EmptyState>
    </section>
  );
}

function WorkInboxInsightPanel({ item }: { item: WorkInboxItem }) {
  return (
    <section
      className="work-inbox-insight-panel"
      aria-label={`AI-ready summary for ${item.thread.subject}`}
    >
      <div className="work-inbox-insight-header">
        <div>
          <span className="relationship-inbox-explainer-label">
            AI-ready summary
          </span>
          <p>{item.summary.summary}</p>
        </div>
        <Badge>{priorityLevelLabel(item.priorityLevel)}</Badge>
      </div>
      <div className="work-inbox-insight-grid">
        <div>
          <strong>Priority</strong>
          <span>
            {priorityLevelLabel(item.priorityLevel)} · Score{" "}
            {item.priorityScore}/100
          </span>
        </div>
        <div>
          <strong>Why it matters</strong>
          <span>{item.whyItMatters}</span>
        </div>
        <div>
          <strong>Intent</strong>
          <span>{item.detectedIntent}</span>
        </div>
        <div>
          <strong>Next action</strong>
          <span>{item.suggestedNextAction}</span>
        </div>
        <div>
          <strong>CRM status</strong>
          <span>{item.crmLinkLabel}</span>
        </div>
      </div>
      {item.waitingOnCustomer ? (
        <div
          className="work-inbox-waiting-summary"
          aria-label="Waiting on customer details"
        >
          <strong>Waiting on customer</strong>
          <span>
            {item.waitingOnCustomer.waitLabel} · Latest outbound{" "}
            {formatDate(item.waitingOnCustomer.latestOutboundAt)} ·{" "}
            {item.waitingOnCustomer.bucketLabel}
          </span>
          <span>{item.waitingOnCustomer.reason}</span>
          {item.waitingOnCustomer.accountState === "disconnected" ? (
            <span>
              Stored email is still reviewable, but the source inbox connection
              is not available for fresh sync context.
            </span>
          ) : null}
        </div>
      ) : null}
      <WorkInboxTriageActions item={item} />
      {item.reasonList.length > 0 ? (
        <div className="work-inbox-priority-reasons">
          <strong>Priority reasoning</strong>
          <ActionGroup className="filter-actions" label="Priority reasons">
            {item.reasonList.map((reason) => (
              <Badge key={reason}>{reason}</Badge>
            ))}
          </ActionGroup>
        </div>
      ) : (
        <div className="work-inbox-priority-reasons">
          <strong>Priority reasoning</strong>
          <p className="form-hint">
            No strong CRM action signals were detected beyond the current
            summary and mailbox context.
          </p>
        </div>
      )}
      {item.isUnimportant ? (
        <div
          className="work-inbox-low-importance"
          aria-label="Why this email is marked unimportant"
        >
          <strong>Why marked unimportant</strong>
          <ActionGroup
            className="filter-actions"
            label="Unimportant email reasons"
          >
            {item.unimportantReasons.map((reason) => (
              <Badge key={reason}>{reason}</Badge>
            ))}
          </ActionGroup>
        </div>
      ) : null}
      {item.unansweredQuestions.length > 0 ? (
        <div className="work-inbox-question-list">
          <strong>Unanswered question</strong>
          {item.unansweredQuestions.map((question) => (
            <span key={question}>{question}</span>
          ))}
        </div>
      ) : null}
      {item.urgencyRisk ? (
        <p className="form-hint">{item.urgencyRisk}</p>
      ) : null}
      {item.missingCrmLinkSuggestion ? (
        <p className="form-hint">{item.missingCrmLinkSuggestion}</p>
      ) : null}
    </section>
  );
}

function WorkInboxTriageActions({ item }: { item: WorkInboxItem }) {
  return (
    <div
      className="work-inbox-triage-actions"
      aria-label={`${item.thread.subject} safe triage actions`}
    >
      <div>
        <strong>Suggested triage</strong>
        <span>
          Review-first actions only. These links do not send email, mutate
          Gmail, or change CRM records automatically.
        </span>
      </div>
      <ActionGroup className="filter-actions" label="Inbox triage actions">
        {item.triageActions.map((action) => {
          const href = workInboxTriageActionHref(action, item);
          return href.startsWith("#") ? (
            <a
              className={
                action.id === "no-action-needed"
                  ? "button-secondary button-compact"
                  : "button-primary button-compact"
              }
              href={href}
              key={action.id}
              title={action.detail}
            >
              {action.label}
            </a>
          ) : (
            <Link
              className="button-secondary button-compact"
              href={href as Route}
              key={action.id}
              title={action.detail}
            >
              {action.label}
            </Link>
          );
        })}
      </ActionGroup>
      <p className="form-hint">{item.triageActions[0]?.detail}</p>
    </div>
  );
}

function workInboxTriageActionHref(
  action: WorkInboxTriageAction,
  item: WorkInboxItem,
) {
  if (action.id === "draft-reply") return "#email-ai-reply-panel";
  if (
    action.id === "create-follow-up" ||
    action.id === "review-follow-up"
  )
    return "#email-follow-up-panel";
  if (action.id === "review-crm-record") {
    return linkedRecordHrefForEmailMessage(item.primaryMessage) ?? "#reader-messages";
  }
  if (
    action.id === "review-pricing" ||
    action.id === "review-contract" ||
    action.id === "review-risk" ||
    action.id === "review-thread" ||
    action.id === "no-action-needed"
  )
    return "#reader-messages";
  return "#reader-messages";
}

function priorityLevelLabel(level: WorkInboxItem["priorityLevel"]) {
  if (level === "high") return "High priority";
  if (level === "medium") return "Medium priority";
  return "Low priority";
}

function compactPriorityLevelLabel(level: WorkInboxItem["priorityLevel"]) {
  if (level === "high") return "High";
  if (level === "medium") return "Med";
  return "Low";
}

type GmailSyncProgress = {
  active: boolean;
  detail: string;
  lastUpdateLabel: string;
  nextStep: string;
  statusLabel: string;
  technicalHint: string | null;
  title: string;
  tone: "attention" | "danger" | "neutral" | "success";
  whatIsHappening: string;
};

function GmailSyncProgressPanel({
  progress,
  provider,
}: {
  progress: GmailSyncProgress;
  provider: ProviderCard | undefined;
}) {
  return (
    <section
      aria-label="Gmail inbox sync progress"
      aria-live={progress.active ? "polite" : undefined}
      className={`gmail-sync-progress gmail-sync-progress-${progress.tone}`}
      id="gmail-sync-progress"
    >
      <PanelTitleRow
        actions={
          <ActionGroup
            className="filter-actions"
            label="Gmail inbox sync actions"
          >
            <Badge>{progress.statusLabel}</Badge>
            <FullInboxPrimaryAction provider={provider} />
            <Link
              aria-label="Refresh Gmail inbox sync status"
              className="button-secondary button-compact"
              href={"/email?syncStatus=1#gmail-sync-progress" as Route}
              title="Refresh Gmail inbox sync status"
            >
              Refresh status
            </Link>
          </ActionGroup>
        }
        description={progress.detail}
        title={progress.title}
      />
      <div className="gmail-sync-progress-grid">
        <div>
          <span>Account</span>
          <strong>
            {provider?.accountEmail ?? "No Gmail account connected"}
          </strong>
        </div>
        <div>
          <span>Current step</span>
          <strong>{progress.whatIsHappening}</strong>
        </div>
        <div>
          <span>Last update</span>
          <strong>{progress.lastUpdateLabel}</strong>
        </div>
        <div>
          <span>Next</span>
          <strong>{progress.nextStep}</strong>
        </div>
      </div>
      {progress.technicalHint ? (
        <p className="form-hint">{progress.technicalHint}</p>
      ) : null}
    </section>
  );
}

function InboxWorkflowItem({
  detail,
  label,
}: {
  detail: string;
  label: string;
}) {
  return (
    <div className="inbox-workflow-item">
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  );
}

function ConnectedGmailAccountsPanel({
  accounts,
  returnTo,
  selectedAccount,
}: {
  accounts: GmailInboxAccountSummary[];
  returnTo: Route;
  selectedAccount: string;
}) {
  if (accounts.length === 0) {
    return (
      <EmailScopeCallout title="Connected inboxes">
        Northstar will suggest your login email first, but you can connect any
        Gmail or Google Workspace inbox you have access to.
      </EmailScopeCallout>
    );
  }

  return (
    <section
      className="connected-inbox-panel"
      aria-label="Connected Gmail and Google Workspace inboxes"
    >
      <CompactTitleRow
        actions={
          <Badge>
            {accounts.length === 1 ? "1 inbox" : `${accounts.length} inboxes`}
          </Badge>
        }
        title="Connected inboxes"
      />
      <div className="connected-inbox-list">
        {accounts.map((account) => {
          const accountSyncMetricText = emailSyncMetricText(account);
          const syncButtonLabel = gmailSyncButtonLabel(
            account.syncHealth,
            "Sync this inbox",
          );
          return (
          <div className="connected-inbox-row" key={account.connectionId}>
            <div>
              <strong>{account.accountEmail ?? account.connectionRef}</strong>
              <span>
                {account.accountDomainType === "consumer_gmail"
                  ? "Consumer Gmail"
                  : "Google Workspace / custom-domain Gmail"}{" "}
                · Ref {account.connectionRef}
              </span>
              <span>
                {account.lastSyncAt
                  ? `Last sync ${formatDate(account.lastSyncAt)}`
                  : "Not synced yet"}
              </span>
              {accountSyncMetricText ? <span>{accountSyncMetricText}</span> : null}
              {account.lastError ? (
                <span>Last issue: {account.lastError}</span>
              ) : null}
              <GmailSyncHealthDetails health={account.syncHealth} />
            </div>
            <ActionGroup
              className="filter-actions"
              label={`${account.accountEmail ?? account.connectionRef} inbox actions`}
            >
              <Badge>{account.status}</Badge>
              {account.syncStatusLabel ? (
                <Badge>{account.syncStatusLabel}</Badge>
              ) : null}
              <Link
                className="button-secondary button-compact"
                href={inboxAccountHref(account.connectionId, {
                  activeTab: "all",
                })}
              >
                View inbox
              </Link>
              {account.syncHealth.recoveryAction === "reconnect_gmail" ? (
                <Link
                  className="button-secondary button-compact"
                  href="/api/email-connections/google/connect"
                >
                  Reconnect
                </Link>
              ) : account.syncAvailable ? (
                <form action={syncGmailInboxFromEmailPageAction}>
                  <input
                    name="account"
                    type="hidden"
                    value={account.connectionId}
                  />
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <button
                    className="button-secondary button-compact"
                    disabled={!account.syncHealth.canRetryNow}
                    type="submit"
                  >
                    {syncButtonLabel}
                  </button>
                </form>
              ) : (
                <Link
                  className="button-secondary button-compact"
                  href="/api/email-connections/google/connect"
                >
                  Reconnect
                </Link>
              )}
              <form action={disconnectEmailProviderFromEmailPageAction}>
                <input
                  name="connectionId"
                  type="hidden"
                  value={account.connectionId}
                />
                <input name="provider" type="hidden" value="GOOGLE_WORKSPACE" />
                <button
                  className="button-secondary button-compact"
                  type="submit"
                >
                  Disconnect
                </button>
              </form>
            </ActionGroup>
          </div>
          );
        })}
      </div>
      {accounts.length > 1 ? (
        <p className="form-hint">
          Unified Inbox combines your connected inboxes only. It does not show
          other workspace members&apos; Gmail accounts.
        </p>
      ) : (
        <p className="form-hint">
          Add another inbox with Connect Gmail or Google Workspace, then switch
          between this inbox and Unified Inbox.
        </p>
      )}
      <p className="form-hint">
        Viewing now: {selectedInboxAccountLabel(selectedAccount, accounts)}.
      </p>
    </section>
  );
}

function RelationshipInboxQueueExplainer({
  explainer,
  subject,
}: {
  explainer: EmailPriorityQueueExplainer;
  subject: string;
}) {
  return (
    <div
      className="relationship-inbox-explainer"
      aria-label={`Why ${subject} is in the Relationship Inbox queue`}
    >
      <span className="relationship-inbox-explainer-label">Why this?</span>
      <span className="relationship-inbox-explainer-headline">
        {explainer.headline}
      </span>
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

function relationshipInboxActionHref(
  action: EmailPriorityNextBestAction,
  hrefs: { draftHref: Route; followUpHref: Route; reviewHref: Route },
): Route {
  if (action.action === "draft_reply") return hrefs.draftHref;
  if (action.action === "review_follow_up") return hrefs.followUpHref;
  if (
    action.action === "classify_email" ||
    action.action === "link_crm_record" ||
    action.action === "no_action_needed" ||
    action.action === "review_potential_lead" ||
    action.action === "review_relationship_risk"
  ) {
    return hrefs.reviewHref;
  }
  return action.href;
}

function RelationshipInboxNextBestAction({
  action,
  actionExplanation,
  actionHref,
  subject,
  workspaceId,
}: {
  action: EmailPriorityNextBestAction;
  actionExplanation: EmailPriorityActionExplanation;
  actionHref: Route;
  subject: string;
  workspaceId: string;
}) {
  const primaryLabel =
    action.action === "no_action_needed" ? "Review email" : action.label;
  const isCompletionAction =
    action.action === "mark_follow_up_complete" &&
    action.followUp?.status === "open";
  return (
    <div className="relationship-inbox-next-action">
      <div>
        <div className="relationship-inbox-next-action-badges">
          <Badge>{action.label}</Badge>
          <Badge>{emailNextBestActionSeverityLabel(action.severity)}</Badge>
        </div>
        <p>{action.reason}</p>
        <div className="relationship-inbox-action-explanation">
          <span className="relationship-inbox-explainer-label">
            Why this action?
          </span>
          <p>{actionExplanation.headline}</p>
          {actionExplanation.contributingSignals.length > 0 ? (
            <div className="relationship-inbox-next-action-badges">
              {actionExplanation.contributingSignals
                .slice(0, 4)
                .map((signal) => (
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
          href={actionHref}
          title={`${primaryLabel} for ${subject}`}
        >
          {primaryLabel}
        </Link>
      )}
    </div>
  );
}

function emailNextBestActionSeverityLabel(
  severity: EmailPriorityNextBestAction["severity"],
) {
  if (severity === "high") return "High priority";
  if (severity === "medium") return "Medium priority";
  return "Low priority";
}

function emailEvidenceSourceLabel(
  source: EmailPriorityQueueExplainer["sources"][number],
) {
  if (source === "smart_label") return "Smart Label";
  if (source === "crm_link") return "CRM link state";
  if (source === "durable_follow_up") return "Durable follow-up link";
  return "Legacy follow-up marker";
}

function emailFollowUpSourceLabel(
  source: EmailPriorityActionExplanation["followUpState"]["source"],
) {
  if (source === "durable") return "Durable follow-up link";
  if (source === "legacy") return "Legacy marker fallback";
  return "No follow-up source";
}

type ProviderCard = NonNullable<
  Awaited<ReturnType<typeof listEmailConnectionProviderCards>>[number]
>;

function buildMajorProviderCards({
  gmailProvider,
  microsoftProvider,
}: {
  gmailProvider?: ProviderCard;
  microsoftProvider?: ProviderCard;
}) {
  const gmailBase = gmailProvider ?? {
    actionLabel: "Configure OAuth",
    detail:
      "Add Google OAuth env vars before Gmail or Google Workspace can connect.",
    disabled: true,
    name: "Gmail",
    provider: "GOOGLE_WORKSPACE" as const,
    scopes: [],
    status: "Not configured",
  };
  const microsoftBase = microsoftProvider ?? {
    actionLabel: "Configure OAuth",
    detail:
      "Add Microsoft OAuth env vars and token encryption before Microsoft 365 or Outlook can connect.",
    disabled: true,
    name: "Microsoft 365",
    provider: "MICROSOFT_365" as const,
    scopes: [],
    status: "Not configured",
  };

  return [
    {
      ...gmailBase,
      actionLabel: gmailActionLabel(gmailBase, "Gmail"),
      name: "Gmail",
      syncLabel: "Sync Gmail inbox",
    },
    {
      ...gmailBase,
      actionLabel: gmailActionLabel(gmailBase, "Google Workspace"),
      detail:
        gmailBase.status === "Connected"
          ? "Google Workspace mailbox connected through the Gmail Full Inbox path for synced reading and explicit replies."
          : "Connect a Google Workspace mailbox through the same Google OAuth path with Gmail read/send scopes.",
      name: "Google Workspace",
      syncLabel: "Sync Google Workspace inbox",
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
      status: microsoftBase.status,
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
      status: microsoftBase.status,
    },
  ];
}

function gmailActionLabel(
  provider: ProviderCard,
  label: "Gmail" | "Google Workspace",
) {
  if (provider.disabled) return provider.actionLabel;
  if (provider.syncAvailable) return `Reconnect ${label}`;
  return `Connect ${label}`;
}

function microsoftActionLabel(
  provider: ProviderCard,
  label: "Microsoft 365" | "Outlook",
) {
  if (provider.disabled) return provider.actionLabel;
  if (provider.syncAvailable) return `Reconnect ${label}`;
  return `Connect ${label}`;
}

function microsoftProviderDetail(
  provider: ProviderCard,
  label: "Microsoft 365" | "Outlook",
) {
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
      (provider.provider === "MICROSOFT_365" &&
        provider.name === "Microsoft 365"))
  );
}

function gmailFullInboxReadiness(provider: ProviderCard | undefined) {
  if (!provider) {
    return {
      description:
        "Configure Google OAuth and token encryption before Gmail or Google Workspace Full Inbox can connect.",
      ready: false,
      statusLine: "Gmail / Google Workspace Full Inbox is not configured yet.",
      title: "Gmail setup required",
    };
  }

  if (provider.status === "Not configured") {
    return {
      description:
        "Add Google OAuth client id, client secret, redirect URI, and token encryption env vars before connecting Gmail or Google Workspace.",
      ready: false,
      statusLine: "Gmail OAuth is not configured for Full Inbox sync.",
      title: "Gmail OAuth is not configured",
    };
  }

  if (provider.status === "Token encryption required") {
    return {
      description:
        "Set EMAIL_TOKEN_ENCRYPTION_KEY before connecting Gmail. Northstar will not store OAuth tokens in plaintext.",
      ready: false,
      statusLine:
        "Gmail OAuth is configured, but encrypted token storage is not ready.",
      title: "Token encryption required",
    };
  }

  if (provider.status === "Reconnect required") {
    return {
      description:
        "Reconnect Gmail or Google Workspace with the current read/send scopes before syncing inbox threads or sending explicit replies.",
      ready: false,
      statusLine: `Gmail is connected${provider.accountEmail ? ` as ${provider.accountEmail}` : ""}, but Full Inbox scopes are missing.`,
      title: "Reconnect Gmail for Full Inbox",
    };
  }

  if (!provider.syncAvailable) {
    return {
      description:
        "Connect Gmail or Google Workspace with Full Inbox scopes, or keep using Relationship Inbox and manual email logging from CRM records.",
      ready: false,
      statusLine: "Gmail Full Inbox is not connected yet.",
      title: "Gmail is not connected",
    };
  }

  if (provider.status === "Sync issue") {
    return {
      description:
        "Gmail is connected, but the latest provider sync reported an issue. Review the redacted provider error and retry sync.",
      ready: true,
      statusLine: `Gmail Full Inbox is connected${provider.accountEmail ? ` as ${provider.accountEmail}` : ""}, with a sync issue to review.`,
      title: "Gmail sync needs attention",
    };
  }

  return {
    description:
      "Gmail Full Inbox is connected. Sync now to queue a mailbox refresh or refresh a selected thread from the inbox reader.",
    ready: true,
    statusLine: `Gmail Full Inbox is connected${provider.accountEmail ? ` as ${provider.accountEmail}` : ""}.`,
    title: "Gmail Full Inbox connected",
  };
}

function gmailSyncProgressState({
  emailConnection,
  skippedMessageFailures,
  provider,
  showRequested,
  syncError,
  syncWarning,
  threadCount,
}: {
  emailConnection: string | undefined;
  skippedMessageFailures: number;
  provider: ProviderCard | undefined;
  showRequested: boolean;
  syncError: string | undefined;
  syncWarning: string | undefined;
  threadCount: number;
}): GmailSyncProgress {
  const readiness = gmailFullInboxReadiness(provider);
  const lastUpdate =
    provider?.syncStatusUpdatedAt ?? provider?.lastSyncAt ?? null;
  const lastUpdateLabel = lastUpdate
    ? formatDate(lastUpdate)
    : "Not updated yet";
  const syncDetail = provider?.syncStatusDetail
    ? formatProviderSyncStatusDetail(provider.syncStatusDetail)
    : null;
  const activeFromClick =
    showRequested ||
    emailConnection === "gmail-sync-queued" ||
    emailConnection === "gmail-sync-error";
  const syncStatusStale = isGmailSyncStatusStale(lastUpdate);
  const visiblePartialWarning =
    searchParamPartialSyncWarning(syncWarning) ??
    (isGmailPartialSyncWarning(provider?.lastError)
      ? provider?.lastError
      : null);

  if (!readiness.ready) {
    return {
      active: false,
      detail: readiness.description,
      lastUpdateLabel,
      nextStep: provider?.href
        ? "Connect or reconnect Gmail"
        : "Open email settings",
      statusLabel: "Setup needed",
      technicalHint: null,
      title: readiness.title,
      tone: "attention",
      whatIsHappening: "Gmail is not ready to sync",
    };
  }

  if (emailConnection === "gmail-sync-error") {
    return {
      active: false,
      detail: syncError
        ? `Gmail sync could not be completed: ${syncError}`
        : (provider?.lastError ??
          syncDetail ??
          "Gmail sync could not be completed. Reconnect Gmail or retry sync."),
      lastUpdateLabel,
      nextStep: gmailSyncErrorNextStep(syncError, provider),
      statusLabel: "Sync failed",
      technicalHint:
        "Full Inbox imports normal Gmail inbox messages before CRM matching. Provider and job errors are redacted before they are shown here.",
      title: "Gmail sync needs attention",
      tone: "danger",
      whatIsHappening: syncError?.includes("Gmail listed")
        ? "Gmail listing worked, but full-message loading failed before storage"
        : "Explicit sync failed before inbox threads were stored",
    };
  }

  if (
    provider?.syncStatusLabel === "Sync queued" ||
    emailConnection === "gmail-sync-queued"
  ) {
    return {
      active: true,
      detail: syncStatusStale
        ? "This Gmail inbox sync has been queued for more than a couple minutes. The background worker has not picked it up yet."
        : "Your Gmail inbox sync is queued. Northstar will start importing recent inbox threads as soon as the sync runner picks it up.",
      lastUpdateLabel,
      nextStep: syncStatusStale
        ? "Start the Railway worker service or refresh status after the worker catches up"
        : "Refresh status in a moment",
      statusLabel: "Sync queued",
      technicalHint:
        "Production Gmail sync needs a running job worker (`npm run jobs:work` or Railway `RAILWAY_SERVICE_ROLE=worker`). The Sync Gmail inbox button queues work through the same durable job path and does not run provider calls in the page request.",
      title: syncStatusStale
        ? "Gmail sync queued with no worker pickup yet"
        : "Waiting to start Gmail sync",
      tone: "attention",
      whatIsHappening: syncDetail ?? "Queued for mailbox import",
    };
  }

  if (provider?.syncStatusLabel === "Sync running") {
    return {
      active: true,
      detail:
        "Northstar is syncing the connected Gmail inbox and storing messages as workspace-scoped email logs.",
      lastUpdateLabel,
      nextStep: "Refresh status to check for new threads",
      statusLabel: "Sync running",
      technicalHint:
        "The sync uses the existing background job path so provider calls stay outside the page request.",
      title: "Syncing Gmail inbox",
      tone: "attention",
      whatIsHappening: syncDetail ?? "Reading Gmail inbox messages",
    };
  }

  if (provider?.syncStatusLabel === "Sync complete") {
    if (visiblePartialWarning) {
      return {
        active: false,
        detail:
          skippedMessageFailures > 0
            ? `${visiblePartialWarning} Synced Gmail threads are ready for review.`
            : visiblePartialWarning,
        lastUpdateLabel,
        nextStep:
          threadCount > 0
            ? "Review synced threads or retry later for skipped messages"
            : "Retry Sync Gmail inbox",
        statusLabel: "Sync completed with warnings",
        technicalHint:
          "Skipped-message diagnostics are sanitized; raw Gmail payloads, headers, bodies, and tokens are not shown.",
        title: "Gmail sync completed with warnings",
        tone: "attention",
        whatIsHappening:
          syncDetail ?? "Mailbox sync finished with skipped messages",
      };
    }
    return {
      active: false,
      detail:
        threadCount > 0
          ? "Gmail sync completed and synced threads are ready in Full Inbox."
          : "Gmail sync completed, but no inbox messages were stored for this workspace.",
      lastUpdateLabel,
      nextStep:
        threadCount > 0
          ? "Review synced threads"
          : "Confirm the mailbox has recent inbox mail",
      statusLabel: "Sync complete",
      technicalHint: null,
      title:
        threadCount > 0
          ? "Gmail sync completed"
          : "Gmail sync completed with no stored messages",
      tone: threadCount > 0 ? "success" : "neutral",
      whatIsHappening: syncDetail ?? "Mailbox sync finished",
    };
  }

  if (
    provider?.syncStatusLabel === "Sync failed" ||
    provider?.syncStatusLabel === "Sync retry scheduled" ||
    provider?.status === "Sync issue"
  ) {
    if (visiblePartialWarning) {
      return {
        active: false,
        detail: visiblePartialWarning,
        lastUpdateLabel,
        nextStep:
          threadCount > 0
            ? "Review synced threads or retry later for skipped messages"
            : "Retry Sync Gmail inbox",
        statusLabel: "Sync completed with warnings",
        technicalHint:
          "Skipped-message diagnostics are sanitized; raw Gmail payloads, headers, bodies, and tokens are not shown.",
        title: "Gmail sync completed with warnings",
        tone: "attention",
        whatIsHappening:
          syncDetail ?? "Mailbox sync finished with skipped messages",
      };
    }
    return {
      active: false,
      detail:
        provider?.lastError ??
        syncDetail ??
        "Gmail sync could not be completed. Reconnect Gmail or retry sync.",
      lastUpdateLabel,
      nextStep:
        provider?.status === "Reconnect required"
          ? "Reconnect Gmail"
          : "Retry Sync Gmail inbox",
      statusLabel: provider?.syncStatusLabel ?? "Sync failed",
      technicalHint: "Provider errors are redacted before they are shown here.",
      title: "Gmail sync needs attention",
      tone: "danger",
      whatIsHappening:
        syncDetail ?? "Sync stopped before inbox threads were stored",
    };
  }

  if (provider?.lastSyncAt && threadCount === 0) {
    return {
      active: false,
      detail:
        "Gmail is connected, but the latest sync did not store any inbox threads.",
      lastUpdateLabel,
      nextStep: "Sync again or check the connected mailbox",
      statusLabel: "No synced messages",
      technicalHint: null,
      title: "Gmail connected, no messages synced yet",
      tone: "neutral",
      whatIsHappening: "Waiting for inbox messages to appear",
    };
  }

  return {
    active: activeFromClick,
    detail:
      threadCount > 0
        ? "Gmail Full Inbox is ready. Sync again to refresh recent mailbox threads."
        : "Gmail Full Inbox is ready, but no sync has completed yet.",
    lastUpdateLabel,
    nextStep: "Click Sync Gmail inbox",
    statusLabel: "Ready to sync",
    technicalHint: null,
    title: threadCount > 0 ? "Gmail inbox ready" : "Ready to sync Gmail inbox",
    tone: "neutral",
    whatIsHappening:
      threadCount > 0
        ? "Showing synced threads"
        : "Waiting for first mailbox sync",
  };
}

function isGmailSyncStatusStale(updatedAt: Date | null | undefined) {
  if (!updatedAt) return false;
  return Date.now() - updatedAt.getTime() > 2 * 60 * 1000;
}

function gmailSyncErrorNextStep(
  syncError: string | undefined,
  provider: ProviderCard | undefined,
) {
  if (syncError?.includes("EMAIL_GMAIL_MESSAGE_AUTH_FAILED")) {
    return "Run diagnostics or check Google Cloud OAuth/Gmail API configuration";
  }
  if (provider?.status === "Reconnect required") {
    return "Reconnect Gmail with Full Inbox scopes";
  }
  if (syncError?.includes("Gmail listed")) {
    return "Retry Sync Gmail inbox; reconnect Gmail if message loading keeps failing";
  }
  return "Retry Sync Gmail inbox";
}

function searchParamPartialSyncWarning(value: string | undefined) {
  return isGmailPartialSyncWarning(value) ? value : null;
}

function fullInboxEmptyStateCopy(
  provider: ProviderCard | undefined,
  threadCount: number,
) {
  if (threadCount > 0) {
    return {
      description:
        "Choose a synced Gmail thread to review stored messages, draft replies, classify, or create follow-ups.",
      title: "Choose an inbox thread",
    };
  }

  const readiness = gmailFullInboxReadiness(provider);
  if (!readiness.ready) {
    return {
      description: `${readiness.description} Relationship Inbox and manual email logging still work without a synced mailbox.`,
      title: readiness.title,
    };
  }

  if (provider?.syncStatusLabel === "Sync queued") {
    return {
      description:
        "Gmail is connected and a Full Inbox sync is queued. Refresh sync status in a moment to see whether messages have been stored.",
      title: "Gmail sync is queued",
    };
  }

  if (provider?.syncStatusLabel === "Sync running") {
    return {
      description:
        "Gmail is connected and a Full Inbox sync is currently running. Messages will appear here after inbox threads are stored.",
      title: "Gmail sync is running",
    };
  }

  if (provider?.status === "Sync issue") {
    return {
      description:
        "Gmail is connected, but the latest Full Inbox sync reported an issue. Review the provider status below, then retry Sync Gmail inbox.",
      title: "Gmail sync needs attention",
    };
  }

  if (provider?.lastSyncAt) {
    return {
      description:
        "Gmail is connected, but no inbox messages have synced yet. Use Sync Gmail inbox to queue the mailbox import and return to the progress panel.",
      title: "Gmail is connected, but no inbox messages have synced yet",
    };
  }

  return {
    description:
      "Gmail is connected, but no inbox sync has completed yet. Use Sync Gmail inbox to queue the mailbox import and watch sync progress here.",
    title: "Gmail is connected, but no inbox messages have synced yet",
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
  providerCards: ReturnType<typeof buildMajorProviderCards>,
) {
  if (!isSyncResult(searchParams?.emailConnection)) return null;
  const provider =
    searchParams?.emailConnection === "microsoft-synced"
      ? "Microsoft"
      : "Gmail";
  const providerStatus = providerCards.find((card) =>
    provider === "Microsoft"
      ? card.provider === "MICROSOFT_365"
      : card.provider === "GOOGLE_WORKSPACE",
  );
  return {
    created: numberParam(searchParams?.created, syncReview?.created),
    duplicates: numberParam(searchParams?.duplicates, syncReview?.duplicates),
    lastSyncAt: providerStatus?.lastSyncAt ?? null,
    messageSkips: numberParam(searchParams?.messageSkips),
    provider,
    skipped: numberParam(searchParams?.skipped, syncReview?.skipped),
    totalFetched: numberParam(searchParams?.total, syncReview?.totalFetched),
  };
}

function numberParam(value: string | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

type EmailSyncMetricSource = {
  lastSyncDuplicateCount?: number | null;
  lastSyncImportedCount?: number | null;
  lastSyncMessageSkipCount?: number | null;
  lastSyncMode?: string | null;
  lastSyncSkippedCount?: number | null;
  lastSyncTotalFetched?: number | null;
};

function emailSyncMetricText(source: EmailSyncMetricSource) {
  if (
    source.lastSyncImportedCount === null ||
    source.lastSyncImportedCount === undefined
  ) {
    return null;
  }

  const skipped =
    (source.lastSyncSkippedCount ?? 0) +
    (source.lastSyncMessageSkipCount ?? 0);
  const parts = [
    `imported ${source.lastSyncImportedCount}`,
    `duplicates ${source.lastSyncDuplicateCount ?? 0}`,
    skipped > 0 ? `skipped ${skipped}` : null,
  ].filter(Boolean);
  const fetched =
    source.lastSyncTotalFetched !== null &&
    source.lastSyncTotalFetched !== undefined
      ? ` from ${source.lastSyncTotalFetched} fetched`
      : "";
  return `${emailSyncModeLabel(source.lastSyncMode)} result: ${parts.join(", ")}${fetched}.`;
}

function gmailSyncButtonLabel(
  health: EmailSyncHealth | null | undefined,
  defaultLabel: string,
) {
  if (!health) return defaultLabel;
  if (
    health.currentState === "dead_lettered" ||
    health.currentState === "failed"
  ) {
    return health.canRetryNow ? "Retry now" : "Retry waiting";
  }
  if (health.currentState === "running") return "Sync running";
  if (health.currentState === "queued" || health.currentState === "delayed")
    return "Sync already queued";
  return defaultLabel;
}

function emailSyncModeLabel(mode: string | null | undefined) {
  if (mode === "older") return "Load older";
  if (mode === "thread") return "Thread refresh";
  return "Last sync";
}

type EmailLog = Awaited<ReturnType<typeof listEmailLogs>>[number];
type DraftTemplate = {
  body: string;
  id: string;
  name: string;
  subject: string;
};

function FullInboxPrimaryAction({
  provider,
  returnTo,
  selectedAccount = "all",
}: {
  provider: ProviderCard | undefined;
  returnTo?: Route;
  selectedAccount?: string;
}) {
  if (provider?.syncAvailable) {
    const label =
      selectedAccount === "all" ? "Sync all inboxes" : "Sync this inbox";
    return (
      <form action={syncGmailInboxFromEmailPageAction}>
        <input name="account" type="hidden" value={selectedAccount} />
        {returnTo ? (
          <input name="returnTo" type="hidden" value={returnTo} />
        ) : null}
        <button
          aria-label={label}
          className="button-primary button-compact"
          title={label}
          type="submit"
        >
          {label}
        </button>
      </form>
    );
  }

  if (provider && !provider.disabled && provider.href) {
    const label =
      provider.status === "Reconnect required"
        ? "Reconnect Gmail"
        : "Connect Gmail or Google Workspace";
    return (
      <Link
        aria-label={`${label} for Full Inbox`}
        className="button-primary button-compact"
        href={emailConnectHrefWithReturnTo(provider.href, returnTo)}
        title={`${label} for Full Inbox`}
      >
        {label}
      </Link>
    );
  }

  return (
    <Link
      aria-label="Open email settings for Gmail setup"
      className="button-secondary button-compact"
      href="/settings#email-connections"
      title="Open email settings for Gmail setup"
    >
      Email settings
    </Link>
  );
}

function EmailInboxEmptyShell({
  accountLabel,
  emptyState,
  provider,
  returnTo,
  selectedAccount,
}: {
  accountLabel: string;
  emptyState: { description: string; title: string };
  provider: ProviderCard | undefined;
  returnTo: Route;
  selectedAccount: string;
}) {
  return (
    <section
      className="email-inbox-empty-state"
      aria-label="No synced Gmail messages"
    >
      <EmptyState
        actions={
          <ActionGroup
            className="filter-actions"
            label="No synced email actions"
          >
            <FullInboxPrimaryAction
              provider={provider}
              returnTo={returnTo}
              selectedAccount={selectedAccount}
            />
            <Link
              className="button-secondary button-compact"
              href={appendEmailStatusParams(returnTo, { syncStatus: "1" })}
            >
              Refresh
            </Link>
          </ActionGroup>
        }
        actionsLabel="No synced email actions"
        description="No stored synced Gmail threads are available for this view yet. Sync this inbox to store recent mail first; older history becomes available through bounded Load older batches after messages exist."
        title="No synced emails yet"
        titleLevel="h2"
      >
        <p className="form-hint">
          Account: {accountLabel}. {emptyState.description} Diagnostics stay
          collapsed below.
        </p>
      </EmptyState>
    </section>
  );
}

function EmailInboxThreadDetail({
  aiReplyReadiness,
  backHref,
  crmLinkSuggestions,
  defaultAiReplyTone,
  draftTemplates,
  followUpDetails,
  insight,
  returnTo,
  smartLabelReadiness,
  thread,
  workspaceId,
}: {
  aiReplyReadiness: EmailReplyAssistantReadiness;
  backHref: Route;
  crmLinkSuggestions: Map<string, EmailCrmLinkSuggestionResult>;
  defaultAiReplyTone: string;
  draftTemplates: DraftTemplate[];
  followUpDetails: Map<string, EmailPriorityFollowUpDetail>;
  insight: WorkInboxItem;
  returnTo: Route;
  smartLabelReadiness: EmailClassificationReadiness;
  thread: EmailInboxThreadSummary;
  workspaceId: string;
}) {
  const replyTarget =
    [...thread.messages]
      .reverse()
      .find(
        (message) =>
          message.provider === "GOOGLE_WORKSPACE" &&
          message.direction === "INBOUND",
      ) ??
    [...thread.messages]
      .reverse()
      .find((message) => message.provider === "GOOGLE_WORKSPACE") ??
    null;
  const primaryMessage = replyTarget ?? thread.latestMessage;
  const recipientEmail = primaryEmailForDraft(
    primaryMessage.direction,
    primaryMessage.fromText,
    primaryMessage.toText,
  );
  const localSmartClassification =
    buildLocalEmailSmartClassification(primaryMessage);
  const localSmartLabels = buildLocalEmailLabelSuggestions(primaryMessage);
  const smartClassification = readEmailSmartClassification(primaryMessage);
  const followUpDraft = buildEmailFollowUpDraftFromEmailLog(primaryMessage);
  return (
    <div
      className="email-inbox-thread-detail inbox-reader-pane inbox-reader-pane-open"
      aria-label={`Inbox thread ${thread.subject}`}
    >
      <Link
        className="button-secondary button-compact inbox-back-link"
        href={backHref}
      >
        Back to inbox
      </Link>
      <div className="email-inbox-thread-header">
        <CompactTitleRow
          actions={
            <ActionGroup
              className="filter-actions"
              label={`${thread.subject} thread status`}
            >
              {thread.isUnread ? <Badge>Unread</Badge> : <Badge>Read</Badge>}
              <Badge>{formatEmailProvider(thread.provider)}</Badge>
              <Badge>
                {thread.messageCount === 1
                  ? "1 message"
                  : `${thread.messageCount} messages`}
              </Badge>
              {thread.provider === "GOOGLE_WORKSPACE" ? (
                <form action={refreshGmailThreadFromEmailPageAction}>
                  <input
                    name="account"
                    type="hidden"
                    value={thread.emailConnectionId ?? "all"}
                  />
                  <input name="threadId" type="hidden" value={thread.id} />
                  <input name="returnTo" type="hidden" value={returnTo} />
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
          description={`${thread.linkedRecordLabel ?? "No linked CRM record"} · ${thread.accountEmail ? `Inbox ${thread.accountEmail} · ` : ""}Latest ${formatDate(thread.latestAt)}`}
          title={thread.subject}
        />
        <div className="email-reader-participants">
          <span>
            {primaryMessage.direction === "INBOUND" ? "From" : "To"}:{" "}
            {primaryMessage.direction === "INBOUND"
              ? (primaryMessage.fromText ?? "Unknown sender")
              : (primaryMessage.toText ?? "Unknown recipient")}
          </span>
          {primaryMessage.toText ? (
            <span>To: {primaryMessage.toText}</span>
          ) : null}
          {primaryMessage.ccText ? (
            <span>Cc: {primaryMessage.ccText}</span>
          ) : null}
          <span>Date: {formatDate(primaryMessage.occurredAt)}</span>
          {primaryMessage.emailConnection?.accountEmail ? (
            <span>
              Source account: {primaryMessage.emailConnection.accountEmail}
            </span>
          ) : null}
        </div>
        <ActionGroup
          className="email-reader-action-bar"
          label={`${thread.subject} reader actions`}
        >
          {replyTarget ? (
            <Badge>
              Reply from{" "}
              {replyTarget.emailConnection?.accountEmail ?? "source account"}
            </Badge>
          ) : null}
          {primaryMessage.person ? (
            <Link
              className="button-secondary button-compact"
              href={"/deals/new" as Route}
              title={`Create deal from email ${primaryMessage.subject}`}
            >
              Link to deal
            </Link>
          ) : null}
        </ActionGroup>
      </div>
      <div className="email-reader-detail-grid">
        <div className="email-reader-main-column">
          <div className="email-reader-message-list" id="reader-messages">
            {thread.messages.map((message) => (
              <EmailReaderMessage key={message.id} message={message} />
            ))}
          </div>
          <section
            className="email-reader-bottom-actions"
            aria-label={`${thread.subject} email actions`}
          >
            {replyTarget ? (
              <div id="gmail-reply-panel">
                <GmailReplyComposer
                  replyTarget={replyTarget}
                  returnTo={returnTo}
                  threadId={thread.id}
                />
              </div>
            ) : null}
            <div id="email-follow-up-panel">
              <EmailFollowUpPanel
                draft={followUpDraft}
                subject={primaryMessage.subject}
              />
            </div>
            <div id="email-draft-panel">
              <EmailDraftPanel
                recipientEmail={recipientEmail}
                subject={primaryMessage.subject}
                templates={draftTemplates.map((template) => ({
                  body: template.body,
                  id: template.id,
                  name: template.name,
                  subject: template.subject,
                }))}
              />
            </div>
          </section>
        </div>
        <aside
          className="email-reader-intelligence-rail"
          aria-label={`${thread.subject} AI and CRM insights`}
        >
          <WorkInboxInsightPanel item={insight} />
          <EmailCrmLinkSuggestionPanel
            emailLogId={primaryMessage.id}
            returnTo={returnTo}
            suggestion={crmLinkSuggestions.get(primaryMessage.id)}
            subject={primaryMessage.subject}
          />
          <EmailSmartLabelPanel
            emailLogId={primaryMessage.id}
            initialClassification={smartClassification}
            localClassification={localSmartClassification}
            localLabels={localSmartLabels}
            readiness={smartLabelReadiness}
            subject={primaryMessage.subject}
          />
          <div id="email-ai-reply-panel">
            <EmailAiReplyPanel
              defaultTone={defaultAiReplyTone}
              emailLogId={primaryMessage.id}
              readiness={aiReplyReadiness}
              recipientEmail={recipientEmail}
              subject={primaryMessage.subject}
            />
          </div>
          <div id="email-linked-follow-ups">
            <EmailLinkedFollowUps
              followUps={followUpDetails.get(primaryMessage.id)?.followUps ?? []}
              subject={primaryMessage.subject}
              workspaceId={workspaceId}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function EmailReaderMessage({
  message,
}: {
  message: EmailInboxThreadSummary["messages"][number];
}) {
  return (
    <article className="email-reader-message" id={`email-card-${message.id}`}>
      <header>
        <div>
          <strong>{message.subject}</strong>
          <span>
            {message.direction === "INBOUND"
              ? (message.fromText ?? "Unknown sender")
              : (message.toText ?? "Unknown recipient")}
          </span>
        </div>
        <time dateTime={message.occurredAt.toISOString()}>
          {formatDate(message.occurredAt)}
        </time>
      </header>
      <pre>
        {message.body?.trim() ||
          "Full message content is unavailable. Try syncing again."}
      </pre>
    </article>
  );
}

function GmailReplyComposer({
  replyTarget,
  returnTo,
  threadId,
}: {
  replyTarget: EmailInboxThreadSummary["messages"][number];
  returnTo: Route;
  threadId: string;
}) {
  const sourceAccount =
    replyTarget.emailConnection?.accountEmail ?? "the source Gmail account";
  return (
    <details className="email-draft-panel email-inbox-reply-panel">
      <summary>Send Gmail reply</summary>
      <p className="form-hint">
        Explicit send only. Northstar sends this reply through {sourceAccount}{" "}
        and logs the sent message.
      </p>
      <form
        action={sendGmailReplyFromEmailPageAction}
        className="email-follow-up-form"
      >
        <input name="emailLogId" type="hidden" value={replyTarget.id} />
        <input name="threadId" type="hidden" value={threadId} />
        <input name="returnTo" type="hidden" value={returnTo} />
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

function emailInboxThreadHref(
  threadId: string,
  options: {
    account: string;
    activeTab: string;
    crmFilter: WorkInboxCrmFilter;
    importanceFilter: WorkInboxImportanceFilter;
    page: number;
    pageSize: number;
    priorityFilter: WorkInboxPriorityFilter;
    query: string;
    sort: WorkInboxSort;
  },
) {
  const params = new URLSearchParams({ thread: threadId });
  if (options.account) params.set("account", options.account);
  params.set("inbox", options.activeTab);
  if (options.page > 1) params.set("page", String(options.page));
  if (options.pageSize !== 50) params.set("pageSize", String(options.pageSize));
  if (options.query) params.set("q", options.query);
  if (options.importanceFilter !== "all")
    params.set("importance", options.importanceFilter);
  if (options.priorityFilter !== "all")
    params.set("priority", options.priorityFilter);
  if (options.crmFilter !== "all") params.set("crm", options.crmFilter);
  if (options.sort !== "newest") params.set("sort", options.sort);
  return `/email?${params.toString()}` as Route;
}

function selectedGmailInboxAccount(
  value: string | undefined,
  accounts: GmailInboxAccountSummary[],
) {
  if (value === "all") return "all";
  if (value && accounts.some((account) => account.connectionId === value))
    return value;
  return accounts.length > 1 ? "all" : (accounts[0]?.connectionId ?? "all");
}

function selectedInboxAccountLabel(
  selectedAccount: string,
  accounts: GmailInboxAccountSummary[],
) {
  if (selectedAccount === "all")
    return accounts.length > 1 ? "All connected inboxes" : "Unified inbox";
  return (
    accounts.find((account) => account.connectionId === selectedAccount)
      ?.accountEmail ?? "Selected inbox"
  );
}

type InboxFreshness = {
  accountLabel: string;
  detail: string;
  label: string;
  lastSyncedAt: Date | null;
  stale: boolean;
  tone: "attention" | "neutral" | "success";
};

const INBOX_FRESHNESS_STALE_MS = 15 * 60 * 1000;

function inboxFreshnessState({
  accounts,
  provider,
  selectedAccount,
  threadCount,
}: {
  accounts: GmailInboxAccountSummary[];
  provider: ProviderCard | undefined;
  selectedAccount: string;
  threadCount: number;
}): InboxFreshness {
  const accountLabel = selectedInboxAccountLabel(selectedAccount, accounts);
  const selectedAccountSummary = accounts.find(
    (account) => account.connectionId === selectedAccount,
  );
  const lastSyncedAt =
    selectedAccount === "all"
      ? (newestAccountSyncAt(accounts) ?? provider?.lastSyncAt ?? null)
      : (selectedAccountSummary?.lastSyncAt ?? provider?.lastSyncAt ?? null);

  if (!lastSyncedAt) {
    return {
      accountLabel,
      detail:
        threadCount > 0
          ? "Stored Gmail threads remain available, but this view has not recorded a completed sync timestamp. Background sync uses the durable job path; use Sync this inbox when you want an explicit refresh."
          : "Use Sync this inbox to queue an explicit Gmail pull. Background sync uses the same durable job path when connected accounts become due.",
      label: "Not synced yet",
      lastSyncedAt: null,
      stale: true,
      tone: "attention",
    };
  }

  const stale = Date.now() - lastSyncedAt.getTime() > INBOX_FRESHNESS_STALE_MS;
  return {
    accountLabel,
    detail: stale
      ? `${accountLabel} freshness is older than 15 minutes. Background sync uses the durable job path; use Sync this inbox when you need an immediate queued refresh.`
      : `${accountLabel} was last synced ${formatDate(lastSyncedAt)}. Background sync will reuse the job path when this inbox becomes due; Sync this inbox remains available for explicit refresh.`,
    label: stale ? "Refresh recommended" : "Recently synced",
    lastSyncedAt,
    stale,
    tone: stale ? "attention" : "success",
  };
}

function emailConnectHrefWithReturnTo(
  href: string | undefined,
  returnTo: Route | undefined,
) {
  if (!href) return "/api/email-connections/google/connect" as Route;
  if (!returnTo || !href.startsWith("/")) return href as Route;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("returnTo", returnTo);
  return `${path}?${params.toString()}` as Route;
}

function appendEmailStatusParams(
  href: Route,
  values: Record<string, string>,
) {
  const [path, query = ""] = String(href).split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
  return `${path}?${params.toString()}` as Route;
}

function emailCrmLinkReviewFilterHref(
  filter: string,
  searchParams: Awaited<EmailPageProps["searchParams"]>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string" && value.trim()) params.set(key, value);
  }
  params.set("crmLink", filter);
  return `/email?${params.toString()}#unlinked-email-review` as Route;
}

function emailPageCurrentReturnHref(
  searchParams: Awaited<EmailPageProps["searchParams"]>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string" && value.trim()) params.set(key, value);
  }
  const query = params.toString();
  return (query ? `/email?${query}` : "/email") as Route;
}

function inboxAccountHref(
  account: string,
  options: {
    activeTab: string;
    crmFilter?: WorkInboxCrmFilter;
    importanceFilter?: WorkInboxImportanceFilter;
    page?: number;
    pageSize?: number;
    priorityFilter?: WorkInboxPriorityFilter;
    query?: string;
    sort?: WorkInboxSort;
  },
) {
  const params = new URLSearchParams({ account, inbox: options.activeTab });
  if (options.page && options.page > 1)
    params.set("page", String(options.page));
  if (options.pageSize && options.pageSize !== 50)
    params.set("pageSize", String(options.pageSize));
  if (options.query) params.set("q", options.query);
  if (options.importanceFilter && options.importanceFilter !== "all")
    params.set("importance", options.importanceFilter);
  if (options.priorityFilter && options.priorityFilter !== "all")
    params.set("priority", options.priorityFilter);
  if (options.crmFilter && options.crmFilter !== "all")
    params.set("crm", options.crmFilter);
  if (options.sort && options.sort !== "newest")
    params.set("sort", options.sort);
  return `/email?${params.toString()}` as Route;
}

function appendInboxToolbarParams(
  href: Route,
  { account, pageSize }: { account: string; pageSize: number },
) {
  const [path, query = ""] = String(href).split("?");
  const params = new URLSearchParams(query);
  params.set("account", account);
  if (pageSize !== 50) params.set("pageSize", String(pageSize));
  return `${path}?${params.toString()}` as Route;
}

function activeInboxFilterLabels({
  activeTab,
  crmFilter,
  importanceFilter,
  priorityFilter,
  query,
  sort,
}: {
  activeTab: string;
  crmFilter: WorkInboxCrmFilter;
  importanceFilter: WorkInboxImportanceFilter;
  priorityFilter: WorkInboxPriorityFilter;
  query: string;
  sort: WorkInboxSort;
}) {
  const labels: string[] = [];
  if (activeTab !== "all") labels.push(`Tab: ${workInboxTabLabel(activeTab)}`);
  if (query) labels.push(`Search: ${query}`);
  if (priorityFilter !== "all")
    labels.push(`Priority: ${priorityFilterLabel(priorityFilter)}`);
  if (crmFilter === "linked") labels.push("CRM: linked");
  if (crmFilter === "unlinked") labels.push("CRM: unlinked");
  if (importanceFilter === "hide-unimportant")
    labels.push("Hiding unimportant");
  if (sort !== "newest") labels.push(`Sort: ${workInboxSortLabel(sort)}`);
  return labels;
}

function workInboxFilterGuidance(
  activeTab: string,
  priorityFilter: WorkInboxPriorityFilter,
) {
  if (priorityFilter === "high") {
    return {
      description:
        "High priority is for direct customer/prospect questions, deadlines, blockers, risk, pricing, quote, contract, or urgent follow-up work.",
      title: "No high priority inbox work",
    };
  }
  if (activeTab === "needs-reply") {
    return {
      description:
        "Needs reply is for inbound messages with an explicit question, requested decision, or clear response needed.",
      title: "No reply-needed messages",
    };
  }
  if (activeTab === "waiting-on-customer") {
    return {
      description:
        "Waiting on Customer is for stored threads where the latest meaningful message was sent by Northstar and no newer meaningful inbound customer response is stored. Automated, marketing, receipt, status-only, and no-reply traffic is excluded.",
      title: "No waiting customer responses",
    };
  }
  if (activeTab === "follow-ups") {
    return {
      description:
        "Follow-up is for messages with next-step language or an existing linked follow-up activity to review.",
      title: "No follow-up messages",
    };
  }
  if (activeTab === "pricing-quote") {
    return {
      description:
        "Pricing / quote is for person-sent commercial requests, proposal questions, or quote-related customer work.",
      title: "No pricing or quote messages",
    };
  }
  if (activeTab === "contract-legal") {
    return {
      description:
        "Contract / legal is for agreement, MSA, SOW, signature, or legal-review messages that need careful review.",
      title: "No contract or legal messages",
    };
  }
  if (activeTab === "relationship-risk") {
    return {
      description:
        "Relationship risk is for escalation, blocker, churn, delay, dissatisfaction, or customer-impact language.",
      title: "No relationship risk messages",
    };
  }
  if (activeTab === "low-automated") {
    return {
      description:
        "Low / automated is for demoted newsletters, receipts, no-reply, promotional, digest, or status-update messages without strong CRM action signals.",
      title: "No low-priority automated messages",
    };
  }
  return {
    description:
      "This queue shows synced Gmail messages that match the current Inbox triage filter.",
    title: "No matching inbox messages",
  };
}

function workInboxTabLabel(tab: string) {
  const labels: Record<string, string> = {
    all: "All",
    "automated-marketing": "Automated / Marketing",
    "contract-legal": "Contract / Legal",
    "crm-linked": "CRM Linked",
    customers: "Customers",
    "follow-ups": "Follow-ups",
    "leads-opportunities": "Leads / Opportunities",
    "low-automated": "Low / Automated",
    "needs-reply": "Needs Reply",
    "personal-low-priority": "Personal / Low Priority",
    "pricing-quote": "Pricing / Quote",
    priority: "Priority",
    "relationship-risk": "Relationship Risk",
    "waiting-on-customer": "Waiting on Customer",
    work: "Work",
  };
  return labels[tab] ?? tab;
}

function priorityFilterLabel(priority: WorkInboxPriorityFilter) {
  if (priority === "high") return "High";
  if (priority === "medium") return "Medium";
  if (priority === "low") return "Low";
  return "Any";
}

function workInboxSortLabel(sort: WorkInboxSort) {
  if (sort === "oldest") return "Oldest first";
  if (sort === "priority") return "Priority";
  if (sort === "unread") return "Unread first";
  return "Newest first";
}

function normalizeInboxPage(value: unknown) {
  const parsed =
    typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeInboxPageSize(value: unknown) {
  const parsed =
    typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (parsed === 25 || parsed === 100) return parsed;
  return 50;
}

function paginateInboxItems(
  items: WorkInboxItem[],
  { page, pageSize }: { page: number; pageSize: number },
) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Math.min(Math.max(1, page), pageCount);
  const start = (normalizedPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: normalizedPage,
    pageCount,
  };
}

type InboxCoverage = {
  loadOlderAccountId: string | null;
  loadOlderAccountLabel: string;
  oldestStoredAt: Date | null;
  viewLastSyncAt: Date | null;
};

function oldestInboxMessageCoverage({
  accounts,
  selectedAccount,
  threads,
}: {
  accounts: GmailInboxAccountSummary[];
  selectedAccount: string;
  threads: EmailInboxThreadSummary[];
}): InboxCoverage {
  let oldest:
    | { connectionId: string | null; occurredAt: Date }
    | null = null;
  for (const thread of threads) {
    for (const message of thread.messages) {
      if (!oldest || message.occurredAt.getTime() < oldest.occurredAt.getTime()) {
        oldest = {
          connectionId: message.emailConnectionId,
          occurredAt: message.occurredAt,
        };
      }
    }
  }
  const loadOlderAccountId =
    selectedAccount === "all"
      ? (oldest?.connectionId ?? null)
      : selectedAccount;
  const selectedAccountSummary = accounts.find(
    (account) => account.connectionId === selectedAccount,
  );
  return {
    loadOlderAccountId,
    loadOlderAccountLabel: loadOlderAccountId
      ? selectedInboxAccountLabel(loadOlderAccountId, accounts)
      : selectedInboxAccountLabel(selectedAccount, accounts),
    oldestStoredAt: oldest?.occurredAt ?? null,
    viewLastSyncAt:
      selectedAccount === "all"
        ? newestAccountSyncAt(accounts)
        : (selectedAccountSummary?.lastSyncAt ?? null),
  };
}

function newestAccountSyncAt(accounts: GmailInboxAccountSummary[]) {
  const timestamps = accounts
    .map((account) => account.lastSyncAt?.getTime() ?? Number.NaN)
    .filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

function EmailLogCard({
  aiReplyReadiness,
  crmLinkSuggestion,
  defaultAiReplyTone,
  draftTemplates,
  emailLog,
  followUpDetail,
  priorityExplainer,
  returnTo,
  showEvidenceAnchor = false,
  smartLabelReadiness,
  workspaceId,
}: {
  aiReplyReadiness: EmailReplyAssistantReadiness;
  crmLinkSuggestion?: EmailCrmLinkSuggestionResult;
  defaultAiReplyTone: string;
  draftTemplates: DraftTemplate[];
  emailLog: EmailLog;
  followUpDetail?: EmailPriorityFollowUpDetail;
  priorityExplainer?: EmailPriorityQueueExplainer;
  returnTo: Route;
  showEvidenceAnchor?: boolean;
  smartLabelReadiness: EmailClassificationReadiness;
  workspaceId: string;
}) {
  const recipientEmail = primaryEmailForDraft(
    emailLog.direction,
    emailLog.fromText,
    emailLog.toText,
  );
  const emailStatusLabel = `${emailLog.subject} email status`;
  const emailActionsLabel = `${emailLog.subject} email actions`;
  const createDealFromEmailLabel = `Create deal from email ${emailLog.subject}`;
  const smartClassification = readEmailSmartClassification(emailLog);
  const localSmartClassification = buildLocalEmailSmartClassification(emailLog);
  const localSmartLabels = buildLocalEmailLabelSuggestions(emailLog);
  const followUpDraft = buildEmailFollowUpDraftFromEmailLog(emailLog);
  return (
    <article className="email-command-card" id={`email-card-${emailLog.id}`}>
      <CompactTitleRow
        actions={
          <ActionGroup
            className="filter-actions"
            label={`${emailLog.subject} source account`}
          >
            <Badge>{formatEmailProvider(emailLog.provider)}</Badge>
            {emailLog.emailConnection?.accountEmail ? (
              <Badge>{emailLog.emailConnection.accountEmail}</Badge>
            ) : null}
          </ActionGroup>
        }
        description={
          <>
            {emailLog.direction === "INBOUND" ? "From" : "To"}{" "}
            {emailLog.direction === "INBOUND"
              ? (emailLog.fromText ?? "Not recorded")
              : (emailLog.toText ?? "Not recorded")}{" "}
            · {formatDate(emailLog.occurredAt)}
          </>
        }
        title={emailLog.subject}
      />
      <ActionGroup className="filter-actions" label={emailStatusLabel}>
        {emailStatusBadges(emailLog).map((badge) => (
          <Badge key={badge}>{badge}</Badge>
        ))}
      </ActionGroup>
      <EmailSourceMessageFacts emailLog={emailLog} />
      <EmailCrmLinkSuggestionPanel
        emailLogId={emailLog.id}
        returnTo={returnTo}
        suggestion={crmLinkSuggestion}
        subject={emailLog.subject}
      />
      <EmailSmartLabelPanel
        emailLogId={emailLog.id}
        initialClassification={smartClassification}
        localClassification={localSmartClassification}
        localLabels={localSmartLabels}
        readiness={smartLabelReadiness}
        subject={emailLog.subject}
      />
      <EmailLinkedFollowUps
        followUps={followUpDetail?.followUps ?? []}
        subject={emailLog.subject}
        workspaceId={workspaceId}
      />
      {priorityExplainer ? (
        <RelationshipInboxEvidenceDetail
          explainer={priorityExplainer}
          subject={emailLog.subject}
          targetId={
            showEvidenceAnchor ? `email-evidence-${emailLog.id}` : undefined
          }
        />
      ) : null}
      <div
        className="email-action-anchor"
        id={emailFollowUpReviewHref(emailLog.id).slice(1)}
      >
        <EmailFollowUpPanel draft={followUpDraft} subject={emailLog.subject} />
      </div>
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
            subject: template.subject,
          }))}
        />
      </ActionGroup>
      <div
        className="email-action-anchor"
        id={emailDraftReviewHref(emailLog.id).slice(1)}
      >
        <EmailAiReplyPanel
          defaultTone={defaultAiReplyTone}
          emailLogId={emailLog.id}
          readiness={aiReplyReadiness}
          recipientEmail={recipientEmail}
          subject={emailLog.subject}
        />
      </div>
    </article>
  );
}

function EmailSourceMessageFacts({ emailLog }: { emailLog: EmailLog }) {
  const linkedRecord = firstEmailLogLinkedRecord(emailLog);
  const sourceFacts = [
    {
      label: "Direction",
      value: emailLog.direction === "INBOUND" ? "Inbound" : "Outbound",
    },
    { label: "From", value: emailLog.fromText ?? "Not recorded" },
    { label: "To", value: emailLog.toText ?? "Not recorded" },
    { label: "Date", value: formatDate(emailLog.occurredAt) },
  ];
  return (
    <section
      aria-label={`${emailLog.subject} source message context`}
      className="email-source-facts"
    >
      <dl>
        {sourceFacts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
        <div>
          <dt>CRM link</dt>
          <dd>
            {linkedRecord ? (
              <Link className="inline-link" href={linkedRecord.href}>
                {linkedRecord.label}
              </Link>
            ) : (
              "No linked CRM record"
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function EmailCrmLinkReviewQueueRow({
  item,
  returnTo,
}: {
  item: EmailCrmLinkReviewItem;
  returnTo: Route;
}) {
  const primary = item.primarySuggestion;
  const candidates = [
    primary,
    ...item.alternativeSuggestions,
  ].filter((candidate): candidate is EmailCrmLinkSuggestion =>
    Boolean(candidate),
  );
  const sourceParticipant =
    item.emailLog.direction === "INBOUND"
      ? (item.emailLog.fromText ?? "Unknown sender")
      : (item.emailLog.toText ?? "Unknown recipient");

  return (
    <article className="email-crm-link-review-row">
      <div className="email-crm-link-review-main">
        <CompactTitleRow
          actions={
            <ActionGroup
              className="filter-actions"
              label={`${item.emailLog.subject} CRM link review state`}
            >
              <Badge>{item.stateLabel}</Badge>
              {item.highConfidenceSuggestionCount > 0 ? (
                <Badge>
                  {item.highConfidenceSuggestionCount} high confidence
                </Badge>
              ) : null}
            </ActionGroup>
          }
          description={`${sourceParticipant} · ${item.emailLog.occurredAt ? formatDate(item.emailLog.occurredAt) : "Date not recorded"}`}
          title={item.emailLog.subject}
        />
        <div className="email-crm-link-review-grid">
          <div>
            <span>Source email</span>
            <strong>{sourceParticipant}</strong>
          </div>
          <div>
            <span>Suggested record</span>
            <strong>
              {primary
                ? primary.label
                : candidates.length > 0
                  ? "Multiple plausible records"
                  : "No reliable match"}
            </strong>
          </div>
          <div>
            <span>Record type</span>
            <strong>
              {primary
                ? emailCrmRecordTypeLabel(primary.type)
                : candidates.length > 0
                  ? "Needs choice"
                  : "None"}
            </strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>
              {primary
                ? primary.confidence
                : candidates.length > 0
                  ? "ambiguous"
                  : "none"}
            </strong>
          </div>
        </div>
        <p className="form-hint">
          {primary
            ? `${primary.why} Evidence: ${primary.evidence}.`
            : candidates.length > 0
              ? "Multiple deterministic matches exist. Review the alternatives before choosing one."
              : "No exact email, confirmed domain, existing association, or same-thread CRM link was found."}
        </p>
        {candidates.length > 0 ? (
          <div className="email-crm-link-review-alternatives">
            {candidates.map((candidate, index) => (
              <div
                className="email-crm-link-review-alternative"
                key={`${candidate.type}-${candidate.recordId}`}
              >
                <div>
                  <ActionGroup
                    className="filter-actions"
                    label={`${candidate.label} review badges`}
                  >
                    <Badge>{emailCrmRecordTypeLabel(candidate.type)}</Badge>
                    <Badge>{candidate.confidence}</Badge>
                    {index === 0 && primary ? (
                      <Badge>Suggested</Badge>
                    ) : (
                      <Badge>Alternative</Badge>
                    )}
                  </ActionGroup>
                  <strong>{candidate.label}</strong>
                  <p>{candidate.why}</p>
                  <p className="form-hint">
                    {emailCrmLinkSourceLabel(candidate.source)} ·{" "}
                    {candidate.evidence}
                  </p>
                </div>
                <EmailCrmLinkCandidateActions
                  candidate={candidate}
                  emailLogId={item.emailLog.id}
                  primary={index === 0 && Boolean(primary)}
                  returnTo={returnTo}
                  subject={item.emailLog.subject}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <ActionGroup
        className="filter-actions"
        label={`${item.emailLog.subject} unlinked review navigation`}
      >
        <Link
          className="button-secondary button-compact"
          href={emailCrmLinkPanelHref(item.emailLog.id)}
        >
          Review card
        </Link>
        {primary ? (
          <Link
            className="button-secondary button-compact"
            href={primary.href as Route}
          >
            Open record
          </Link>
        ) : null}
      </ActionGroup>
    </article>
  );
}

function EmailCrmLinkSuggestionPanel({
  emailLogId,
  returnTo,
  suggestion,
  subject,
}: {
  emailLogId: string;
  returnTo: Route;
  suggestion?: EmailCrmLinkSuggestionResult;
  subject: string;
}) {
  if (!suggestion || suggestion.alreadyLinked) return null;
  const candidates = [
    suggestion.primarySuggestion,
    ...suggestion.alternativeSuggestions,
  ].filter(
    (
      candidate,
    ): candidate is NonNullable<
      EmailCrmLinkSuggestionResult["primarySuggestion"]
    > => Boolean(candidate),
  );
  const hasReliableCandidates = candidates.length > 0;
  const panelLabel = `${subject} CRM link suggestions`;

  return (
    <section
      aria-label={panelLabel}
      className={
        hasReliableCandidates
          ? "email-crm-link-suggestions"
          : "email-crm-link-suggestions email-crm-link-suggestions-empty"
      }
      id={`email-crm-link-${emailLogId}`}
    >
      <PanelTitleRow
        actions={
          <Badge>
            {hasReliableCandidates ? "Review first" : "No reliable match"}
          </Badge>
        }
        description={
          hasReliableCandidates
            ? "Northstar found deterministic CRM evidence. Review the record before linking."
            : (suggestion.noReliableMatchReason ??
              "No reliable CRM match found.")
        }
        title="CRM Link Assistance"
      />
      {hasReliableCandidates ? (
        <div className="email-crm-link-candidate-list">
          {candidates.map((candidate, index) => (
            <div
              className="email-crm-link-candidate"
              key={`${candidate.type}-${candidate.recordId}`}
            >
              <div className="email-crm-link-candidate-main">
                <ActionGroup
                  className="filter-actions"
                  label={`${candidate.label} match strength`}
                >
                  <Badge>{emailCrmRecordTypeLabel(candidate.type)}</Badge>
                  <Badge>{candidate.confidence} confidence</Badge>
                  {index === 0 && suggestion.primarySuggestion ? (
                    <Badge>Suggested</Badge>
                  ) : (
                    <Badge>Alternative</Badge>
                  )}
                </ActionGroup>
                <strong>{candidate.label}</strong>
                <p>{candidate.why}</p>
                <p className="form-hint">
                  Evidence: {candidate.evidence} ·{" "}
                  {emailCrmLinkSourceLabel(candidate.source)}
                </p>
              </div>
              <ActionGroup
                className="filter-actions"
                label={`${candidate.label} link actions`}
              >
                <Link
                  className="button-secondary button-compact"
                  href={candidate.href as Route}
                >
                  Open record
                </Link>
                <EmailCrmLinkCandidateForm
                  candidate={candidate}
                  emailLogId={emailLogId}
                  primary={index === 0 && Boolean(suggestion.primarySuggestion)}
                  returnTo={returnTo}
                  subject={subject}
                />
              </ActionGroup>
            </div>
          ))}
        </div>
      ) : (
        <p className="form-hint">
          Use manual CRM review when there is enough context. Northstar will not
          guess or create a record from this email.
        </p>
      )}
    </section>
  );
}

function EmailCrmLinkCandidateActions({
  candidate,
  emailLogId,
  primary,
  returnTo,
  subject,
}: {
  candidate: EmailCrmLinkSuggestion;
  emailLogId: string;
  primary: boolean;
  returnTo: Route;
  subject: string;
}) {
  return (
    <ActionGroup
      className="filter-actions"
      label={`${candidate.label} link actions`}
    >
      <Link
        className="button-secondary button-compact"
        href={candidate.href as Route}
      >
        Open record
      </Link>
      <EmailCrmLinkCandidateForm
        candidate={candidate}
        emailLogId={emailLogId}
        primary={primary}
        returnTo={returnTo}
        subject={subject}
      />
    </ActionGroup>
  );
}

function EmailCrmLinkCandidateForm({
  candidate,
  emailLogId,
  primary,
  returnTo,
  subject,
}: {
  candidate: EmailCrmLinkSuggestion;
  emailLogId: string;
  primary: boolean;
  returnTo: Route;
  subject: string;
}) {
  return (
    <form action={linkEmailLogToCrmRecordFromEmailPageAction}>
      <input name="emailLogId" type="hidden" value={emailLogId} />
      <input name="recordType" type="hidden" value={candidate.type} />
      <input name="recordId" type="hidden" value={candidate.recordId} />
      <input
        name="returnTo"
        type="hidden"
        value={emailReturnToCrmLinkPanel(returnTo, emailLogId)}
      />
      <button
        aria-label={`Link email ${subject} to ${candidate.label}`}
        className={
          primary ? "button-primary button-compact" : "button-secondary button-compact"
        }
        type="submit"
      >
        Link {emailCrmRecordTypeLabel(candidate.type).toLowerCase()}
      </button>
    </form>
  );
}

function emailCrmRecordTypeLabel(
  type: NonNullable<
    EmailCrmLinkSuggestionResult["primarySuggestion"]
  >["type"],
) {
  if (type === "PERSON") return "Contact";
  if (type === "ORGANIZATION") return "Organization";
  if (type === "DEAL") return "Deal";
  return "Lead";
}

function emailCrmLinkSourceLabel(
  source: NonNullable<
    EmailCrmLinkSuggestionResult["primarySuggestion"]
  >["source"],
) {
  if (source === "exact_email") return "exact email match";
  if (source === "organization_domain") return "confirmed domain match";
  if (source === "participant_association") return "existing CRM association";
  return "same-thread CRM context";
}

function RelationshipInboxEvidenceDetail({
  explainer,
  subject,
  targetId,
}: {
  explainer: EmailPriorityQueueExplainer;
  subject: string;
  targetId?: string;
}) {
  const categoryItems = explainer.trail.filter(
    (item) => item.type === "category",
  );
  const signalItems = explainer.trail.filter((item) => item.type === "signal");
  const remainingTrailItems = explainer.trail.filter(
    (item) => item.type !== "category" && item.type !== "signal",
  );
  const savedExcerpts = uniqueEvidenceExcerpts(
    explainer.trail.flatMap((item) => [
      ...(item.excerpts ?? []),
      ...(item.excerpt ? [item.excerpt] : []),
    ]),
  );
  return (
    <section
      aria-label={`Full Relationship Inbox evidence for ${subject}`}
      className="relationship-inbox-evidence-detail"
      id={targetId}
    >
      <div className="relationship-inbox-evidence-detail-header">
        <div>
          <span className="relationship-inbox-explainer-label">
            Relationship Inbox evidence
          </span>
          <p>{explainer.headline}</p>
        </div>
        <Badge>{emailNextBestActionSeverityLabel(explainer.severity)}</Badge>
      </div>
      <RelationshipInboxActionExplanationDetail
        explanation={explainer.actionExplanation}
      />
      {categoryItems.length > 0 ? (
        <div className="relationship-inbox-evidence-group">
          <span className="relationship-inbox-explainer-label">
            Category evidence
          </span>
          {categoryItems.map((item) => (
            <RelationshipInboxEvidenceDrilldown item={item} key={item.id} />
          ))}
        </div>
      ) : null}
      {signalItems.length > 0 ? (
        <div className="relationship-inbox-evidence-group">
          <span className="relationship-inbox-explainer-label">
            Signal evidence
          </span>
          {signalItems.map((item) => (
            <RelationshipInboxEvidenceDrilldown item={item} key={item.id} />
          ))}
        </div>
      ) : null}
      <div className="relationship-inbox-evidence-trail">
        <span className="relationship-inbox-explainer-label">
          CRM, follow-up, and action trail
        </span>
        {remainingTrailItems.map((item) => (
          <RelationshipInboxEvidenceTrailItem item={item} key={item.id} />
        ))}
      </div>
      {savedExcerpts.length > 0 ? (
        <div className="relationship-inbox-source-excerpts">
          <span className="relationship-inbox-explainer-label">
            Supporting excerpts
          </span>
          {savedExcerpts.map((item) => (
            <blockquote
              className="relationship-inbox-evidence-excerpt"
              key={`excerpt-${item}`}
            >
              {item}
            </blockquote>
          ))}
          <p className="form-hint">
            These are saved Smart Label excerpts. Exact source text offsets are
            not stored, so Northstar does not claim character-level highlights.
          </p>
        </div>
      ) : (
        <p className="form-hint">
          No saved source excerpts are available for this queue item.
        </p>
      )}
    </section>
  );
}

function RelationshipInboxActionExplanationDetail({
  explanation,
}: {
  explanation: EmailPriorityActionExplanation;
}) {
  return (
    <section
      className="relationship-inbox-action-detail"
      aria-label="Why this action is recommended"
    >
      <div className="relationship-inbox-evidence-detail-header">
        <div>
          <span className="relationship-inbox-explainer-label">
            Why this action?
          </span>
          <p>{explanation.headline}</p>
        </div>
        <Badge>{emailNextBestActionSeverityLabel(explanation.severity)}</Badge>
      </div>
      <p>{explanation.reason}</p>
      <div className="relationship-inbox-action-chain">
        <div>
          <span className="relationship-inbox-explainer-label">Signals</span>
          {explanation.contributingSignals.length > 0 ? (
            <ActionGroup
              className="filter-actions"
              label="Signals contributing to recommended action"
            >
              {explanation.contributingSignals.map((signal) => (
                <Badge key={signal.key}>{signal.label}</Badge>
              ))}
            </ActionGroup>
          ) : (
            <p className="form-hint">
              No saved signal directly contributes; the recommendation is based
              on classification or CRM state.
            </p>
          )}
        </div>
        <div>
          <span className="relationship-inbox-explainer-label">CRM state</span>
          <p className="form-hint">{explanation.crmState.label}</p>
        </div>
        <div>
          <span className="relationship-inbox-explainer-label">
            Follow-up state
          </span>
          <p className="form-hint">
            {explanation.followUpState.label}
            {explanation.followUpState.source
              ? ` · ${emailFollowUpSourceLabel(explanation.followUpState.source)}`
              : ""}
            {explanation.followUpState.openCount > 0
              ? ` · ${explanation.followUpState.openCount} open`
              : ""}
            {explanation.followUpState.completedCount > 0
              ? ` · ${explanation.followUpState.completedCount} completed`
              : ""}
          </p>
        </div>
      </div>
      {explanation.contributingSignals.some(
        (signal) => signal.excerpts.length > 0 || signal.reason,
      ) ? (
        <div className="relationship-inbox-action-signal-map">
          {explanation.contributingSignals.map((signal) => (
            <details
              className="relationship-inbox-evidence-drilldown"
              key={signal.key}
              open={signal.excerpts.length > 0}
            >
              <summary>
                <Badge>{signal.label}</Badge>
                <span>
                  {signal.reason ??
                    "Saved signal contributed to the recommended action."}
                </span>
              </summary>
              {signal.excerpts.length > 0 ? (
                <div className="relationship-inbox-evidence-drilldown-body">
                  {signal.excerpts.map((excerpt) => (
                    <blockquote
                      className="relationship-inbox-evidence-excerpt"
                      key={`${signal.key}-${excerpt}`}
                    >
                      {excerpt}
                    </blockquote>
                  ))}
                </div>
              ) : (
                <p className="form-hint">
                  No signal-specific excerpt is saved for this action reason.
                </p>
              )}
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RelationshipInboxEvidenceDrilldown({
  item,
}: {
  item: EmailPriorityQueueEvidenceTrailItem;
}) {
  const excerpts = item.excerpts ?? [];
  const targetLabel = item.target?.label ?? "Review evidence";
  return (
    <details
      className="relationship-inbox-evidence-drilldown"
      open={excerpts.length > 0}
    >
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
            <blockquote
              className="relationship-inbox-evidence-excerpt"
              key={`${item.id}-${excerpt}`}
            >
              {excerpt}
            </blockquote>
          ))}
        </div>
      ) : (
        <p className="form-hint">
          No signal-specific excerpt is saved for this label; see the flat
          supporting excerpts below.
        </p>
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

function RelationshipInboxEvidenceTrailItem({
  item,
}: {
  item: EmailPriorityQueueEvidenceTrailItem;
}) {
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
          <blockquote
            className="relationship-inbox-evidence-excerpt"
            key={`${item.id}-${excerpt}`}
          >
            {excerpt}
          </blockquote>
        ))}
        {item.excerpt ? (
          <blockquote className="relationship-inbox-evidence-excerpt">
            {item.excerpt}
          </blockquote>
        ) : null}
        {item.followUp ? (
          <p className="form-hint">
            Follow-up: {item.followUp.title} ·{" "}
            {item.followUp.status === "completed" ? "Completed" : "Open"}
            {item.followUp.dueAt
              ? ` · Due ${formatDate(item.followUp.dueAt)}`
              : ""}
            {item.followUp.completedAt
              ? ` · Completed ${formatDate(item.followUp.completedAt)}`
              : ""}
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
  return Array.from(
    new Set(
      values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean),
    ),
  );
}

function EmailLinkedFollowUps({
  compact = false,
  followUps,
  subject,
  workspaceId,
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
    <div
      className={
        compact
          ? "email-linked-follow-ups email-linked-follow-ups-compact"
          : "email-linked-follow-ups"
      }
    >
      <ActionGroup className="filter-actions" label={linkedFollowUpsLabel}>
        <Badge>
          {followUps.length === 1
            ? "1 linked follow-up"
            : `${followUps.length} linked follow-ups`}
        </Badge>
        {followUps.some((followUp) => followUp.status === "open") ? (
          <Badge>Open follow-up</Badge>
        ) : (
          <Badge>Completed</Badge>
        )}
      </ActionGroup>
      <div className="email-linked-follow-up-list">
        {visibleFollowUps.map((followUp) => (
          <div className="email-linked-follow-up-row" key={followUp.id}>
            <div className="email-linked-follow-up-main">
              <span className="email-linked-follow-up-title">
                {followUp.title}
              </span>
              <span className="muted">
                {emailLinkedFollowUpStatusLabel(followUp)} ·{" "}
                {followUp.dueAt
                  ? `Due ${formatDate(followUp.dueAt)}`
                  : "No due date"}
                {followUp.linkedRecord
                  ? ` · ${followUp.linkedRecord.label}`
                  : ""}
              </span>
            </div>
            <ActionGroup
              className="filter-actions"
              label={`${followUp.title} follow-up actions`}
            >
              {followUp.source === "legacy" ? (
                <Badge>Legacy match</Badge>
              ) : null}
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
        <p className="form-hint">
          {followUps.length - visibleFollowUps.length} more linked follow-up
          activities on the email card.
        </p>
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

function EmailPreviewCard({
  draftTemplates,
  preview,
}: {
  draftTemplates: DraftTemplate[];
  preview: EmailSyncPreview;
}) {
  const name = displayNameFromParticipant(
    preview.direction === "INBOUND" ? preview.fromText : preview.toText,
  );
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
            {preview.direction === "INBOUND"
              ? (preview.fromText ?? preview.email ?? "Unknown")
              : (preview.toText ?? preview.email ?? "Unknown")}{" "}
            · {formatDate(preview.occurredAt)}
          </>
        }
        title={preview.subject}
      />
      <ActionGroup className="filter-actions" label={previewStatusLabel}>
        <Badge>Unmatched</Badge>
        <Badge>Possible new contact</Badge>
        {preview.direction === "INBOUND" ? (
          <Badge>Follow-up suggested</Badge>
        ) : null}
      </ActionGroup>
      {preview.snippet ? (
        <p className="email-preview">{preview.snippet}</p>
      ) : null}
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
          subject: template.subject,
        }))}
      />
    </article>
  );
}

function emailNeedsAttention(emailLog: EmailLog) {
  return emailLog.direction === "INBOUND" || emailLog.deal?.status === "OPEN";
}

function emailStatusBadges(emailLog: EmailLog) {
  const badges = ["Linked"];
  if (emailLog.deal?.status === "OPEN") badges.push("Deal communication");
  if (emailLog.direction === "INBOUND")
    badges.push(
      isOlderThanDays(emailLog.occurredAt, 3)
        ? "Needs follow-up"
        : "Follow-up suggested",
    );
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

function emailCardHref(emailLogId: string) {
  return `#email-card-${emailLogId}` as Route;
}

function emailCrmLinkPanelHref(emailLogId: string) {
  return `#email-crm-link-${emailLogId}` as Route;
}

function emailDraftReviewHref(emailLogId: string) {
  return `#email-draft-review-${emailLogId}` as Route;
}

function emailFollowUpReviewHref(emailLogId: string) {
  return `#email-follow-up-review-${emailLogId}` as Route;
}

function emailReturnToCrmLinkPanel(returnTo: Route, emailLogId: string) {
  const url = new URL(returnTo, "https://northstar.local");
  url.hash = emailCrmLinkPanelHref(emailLogId).slice(1);
  return `${url.pathname}${url.search}${url.hash}` as Route;
}

function primaryEmailForDraft(
  direction: string,
  fromText: string | null,
  toText: string | null,
) {
  const source = direction === "INBOUND" ? fromText : toText;
  return extractFirstEmail(source);
}

function extractFirstEmail(value: string | null | undefined) {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function displayNameFromParticipant(value: string | null | undefined) {
  if (!value) return undefined;
  const withoutEmail = value.replace(/<[^>]+>/g, "").trim();
  return withoutEmail && !withoutEmail.includes("@")
    ? withoutEmail.slice(0, 120)
    : undefined;
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
  params.set(
    "title",
    email ? `Email from ${email}` : subject || "Email follow-up",
  );
  return `/leads/new?${params.toString()}` as Route;
}

function emailStatusCopy(
  searchParams: Awaited<EmailPageProps["searchParams"]>,
) {
  if (searchParams?.emailConnection === "gmail-synced") {
    const messageSkips = numberParam(searchParams.messageSkips);
    if (messageSkips > 0) {
      return `Gmail Full Inbox sync finished with warnings. Stored ${searchParams.created ?? "0"} new message${
        searchParams.created === "1" ? "" : "s"
      }; found ${searchParams.duplicates ?? "0"} duplicate; skipped ${messageSkips} Gmail message${
        messageSkips === 1 ? "" : "s"
      } that could not be loaded.`;
    }
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
    return searchParams.syncError
      ? `Gmail Full Inbox sync was not completed: ${searchParams.syncError}`
      : "Gmail Full Inbox sync was not completed. Google granted Gmail access, but Gmail rejected full-message reads. Run diagnostics or check Google Cloud OAuth/Gmail API configuration.";
  }
  if (searchParams?.emailConnection === "gmail-sync-queued") {
    const queued = numberParam(searchParams.queued);
    return queued > 1
      ? `${queued} Gmail inbox syncs are queued. Watch the Gmail sync progress panel for current status, then refresh status to check for synced threads.`
      : "Gmail inbox sync is queued. Watch the Gmail sync progress panel for current status, then refresh status to check for synced threads.";
  }
  if (searchParams?.emailConnection === "gmail-loaded-more") {
    const messageSkips = numberParam(searchParams.messageSkips);
    if (messageSkips > 0) {
      return `Older Gmail messages loaded with warnings. Stored ${searchParams.created ?? "0"} new message${
        searchParams.created === "1" ? "" : "s"
      }; found ${searchParams.duplicates ?? "0"} duplicate; skipped ${messageSkips} Gmail message${
        messageSkips === 1 ? "" : "s"
      } that could not be loaded.`;
    }
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
  if (searchParams?.emailConnection === "crm-linked") {
    return "Email linked to the selected CRM record. Follow-ups and Relationship Inbox state remain review-first.";
  }
  if (searchParams?.emailConnection === "crm-link-error") {
    return "Email was not linked. Refresh the suggestion, confirm the record is still in this workspace, and try again.";
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

function linkedRecordHrefForEmailMessage(
  message: EmailInboxThreadSummary["messages"][number],
) {
  if (message.dealId) return `/deals/${message.dealId}` as Route;
  if (message.leadId) return `/leads/${message.leadId}` as Route;
  if (message.organizationId)
    return `/organizations/${message.organizationId}` as Route;
  if (message.personId) return `/contacts/${message.personId}` as Route;
  return null;
}

function firstEmailLogLinkedRecord(emailLog: EmailLog) {
  if (emailLog.deal) {
    return {
      href: `/deals/${emailLog.deal.id}` as Route,
      label: emailLog.deal.title,
    };
  }
  if (emailLog.lead) {
    return {
      href: `/leads/${emailLog.lead.id}` as Route,
      label: emailLog.lead.title,
    };
  }
  if (emailLog.person) {
    return {
      href: `/contacts/${emailLog.person.id}` as Route,
      label: formatPersonName(emailLog.person) ?? "Unnamed contact",
    };
  }
  if (emailLog.organization) {
    return {
      href: `/organizations/${emailLog.organization.id}` as Route,
      label: emailLog.organization.name,
    };
  }
  return null;
}

function EmailLogLinks({
  emailLog,
}: {
  emailLog: Awaited<ReturnType<typeof listEmailLogs>>[number];
}) {
  const links = [
    emailLog.person
      ? {
          href: `/contacts/${emailLog.person.id}` as Route,
          label: formatPersonName(emailLog.person) ?? "Unnamed contact",
          type: "contact",
        }
      : null,
    emailLog.organization
      ? {
          href: `/organizations/${emailLog.organization.id}` as Route,
          label: emailLog.organization.name,
          type: "account",
        }
      : null,
    emailLog.deal
      ? {
          href: `/deals/${emailLog.deal.id}` as Route,
          label: emailLog.deal.title,
          type: "deal",
        }
      : null,
    emailLog.lead
      ? {
          href: `/leads/${emailLog.lead.id}` as Route,
          label: emailLog.lead.title,
          type: "lead",
        }
      : null,
  ].filter(
    (
      link,
    ): link is {
      href: Route;
      label: string;
      type: "account" | "contact" | "deal" | "lead";
    } => Boolean(link),
  );

  if (links.length === 0)
    return <InlineEmptyStateText>No linked CRM record</InlineEmptyStateText>;

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
