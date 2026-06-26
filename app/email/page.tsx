import Link from "next/link";
import type { Route } from "next";
import { cookies } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { EmailDraftPanel } from "@/components/email-draft-panel";
import { formatDate } from "@/components/format";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { listEmailConnectionProviderCards, listEmailLogs, listEmailTemplates } from "@/lib/services/crm";
import type { EmailSyncPreview } from "@/lib/services/email-connection-service";
import { syncRecentGmailFromEmailPageAction, syncRecentMicrosoftFromEmailPageAction } from "./actions";
import { decodeEmailSyncReview, emailSyncReviewCookieName } from "./sync-review";

export const dynamic = "force-dynamic";

type EmailPageProps = {
  searchParams?: Promise<{
    created?: string;
    duplicates?: string;
    emailConnection?: string;
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
  const gmailProvider = providers.find((provider) => provider.provider === "GOOGLE_WORKSPACE");
  const microsoftProvider = providers.find((provider) => provider.provider === "MICROSOFT_365");
  const imapProvider = providers.find((provider) => provider.provider === "IMAP_SMTP");
  const majorProviderCards = buildMajorProviderCards({ gmailProvider, microsoftProvider });
  const statusCopy = emailStatusCopy(resolvedSearchParams);
  const syncSummary = buildSyncSummary(resolvedSearchParams, latestSyncReview, majorProviderCards);
  const draftTemplates = emailTemplates.map((template) => ({
    body: template.body,
    id: template.id,
    name: template.name,
    subject: template.subject
  }));
  const attentionLogs = recentEmailLogs.filter((emailLog) => emailNeedsAttention(emailLog)).slice(0, 6);

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Communication</p>
          <h1 className="page-title">Email</h1>
        </div>
        <div className="header-actions">
          <Link className="button-secondary" href="/settings#email-connections">
            Email settings
          </Link>
        </div>
      </header>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Email Providers</h2>
          <span className="badge">{gmailProvider?.status ?? "Not configured"}</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 12 }}>
          Northstar syncs recent email metadata/snippets from connected providers and logs matched emails to known
          contacts. It does not import full inboxes, attachments, full message bodies, or send email yet. Unmatched
          messages are skipped.
        </p>
        {!gmailProvider?.syncAvailable ? (
          <div className="empty-state" style={{ marginBottom: 14 }}>
            <h3>No email connected yet</h3>
            <p>Connect Gmail / Google Workspace when OAuth is configured, or keep logging email manually from CRM records.</p>
          </div>
        ) : null}
        {statusCopy ? <p className="empty-copy">{statusCopy}</p> : null}
        <div className="provider-card-grid" style={{ marginTop: 14 }}>
          {majorProviderCards.map((provider) => (
            <div className="provider-card" key={provider.name}>
              <div>
                <h3>{provider.name}</h3>
                <span className="badge">{provider.status}</span>
              </div>
              <p>{provider.detail}</p>
              {provider.accountEmail ? <p>Connected account: {provider.accountEmail}</p> : null}
              {provider.lastSyncAt ? <p>Last sync: {formatDate(provider.lastSyncAt)}</p> : null}
              {provider.scopes.length > 0 ? <p>Scopes: {provider.scopes.join(", ")}</p> : null}
              {provider.disabled || !provider.href ? (
                <button className="button-secondary button-compact" disabled type="button">
                  {provider.actionLabel}
                </button>
              ) : (
                <div className="filter-actions">
                  <Link className="button-primary button-compact" href={provider.href as Route}>
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
                      <button className="button-secondary button-compact" type="submit">
                        {provider.syncLabel ?? "Sync recent Gmail"}
                      </button>
                    </form>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
        {imapProvider ? (
          <p className="empty-copy" style={{ marginTop: 12 }}>
            IMAP/SMTP is planned as a fallback for Yahoo Mail, Zoho Mail, Fastmail, iCloud, custom domains, and
            hosting-provider email. It is not live yet.
          </p>
        ) : null}
      </section>

      {syncSummary ? (
        <section className="data-card" style={{ marginBottom: 16 }}>
          <div className="panel-title-row">
            <h2 className="panel-title">Latest Sync Result</h2>
            <span className="badge">{syncSummary.provider}</span>
          </div>
          <div className="stat-grid stat-grid-compact" style={{ marginBottom: 12 }}>
            <div className="stat-card">
              <p className="stat-label">Fetched</p>
              <p className="stat-value">{syncSummary.totalFetched}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Logged</p>
              <p className="stat-value">{syncSummary.created}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Duplicates</p>
              <p className="stat-value">{syncSummary.duplicates}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Unmatched</p>
              <p className="stat-value">{syncSummary.skipped}</p>
            </div>
          </div>
          <p className="empty-copy">
            Last sync: {syncSummary.lastSyncAt ? formatDate(syncSummary.lastSyncAt) : "Just now"}. Synced emails are
            logged only when they match known CRM contacts. Unmatched previews below are temporary and not stored as CRM
            history.
          </p>
          {syncSummary.totalFetched > 0 && syncSummary.created === 0 ? (
            <p className="empty-copy" style={{ marginTop: 8 }}>
              No matches yet — add contacts or create them from email so future syncs can link messages to CRM timelines.
            </p>
          ) : null}
        </section>
      ) : null}

      {latestSyncReview?.unmatchedPreviews.length ? (
        <section className="data-card" style={{ marginBottom: 16 }}>
          <div className="panel-title-row">
            <h2 className="panel-title">Unmatched Email Review</h2>
            <span className="badge">Temporary</span>
          </div>
          <p className="empty-copy" style={{ marginBottom: 12 }}>
            These recent messages did not match existing contacts. Create a contact or lead, or ignore them for now.
            Northstar is not storing unmatched inbox history.
          </p>
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

      {attentionLogs.length > 0 ? (
        <section className="data-card" style={{ marginBottom: 16 }}>
          <div className="panel-title-row">
            <h2 className="panel-title">Suggested Follow-ups</h2>
            <span className="badge">{attentionLogs.length} need attention</span>
          </div>
          <div className="email-command-list">
            {attentionLogs.map((emailLog) => (
              <EmailLogCard draftTemplates={draftTemplates} emailLog={emailLog} key={emailLog.id} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="data-card">
        <div className="panel-title-row">
          <h2 className="panel-title">Synced Emails</h2>
          <span className="badge">{recentEmailLogs.length} shown</span>
        </div>
        {recentEmailLogs.length > 0 ? (
          <div className="email-command-list">
            {recentEmailLogs.map((emailLog) => (
              <EmailLogCard draftTemplates={draftTemplates} emailLog={emailLog} key={emailLog.id} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>No email activity yet</h3>
            <p>
              Log an email manually from a deal, contact, organization, or lead. After Gmail is connected, manual sync
              will add recent matched messages from known contacts here. No matches yet? Create contacts from unmatched
              emails after your next sync.
            </p>
          </div>
        )}
      </section>
    </AppShell>
  );
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
  if (provider.status === "Connected") return `Reconnect ${label}`;
  return `Connect ${label}`;
}

function microsoftActionLabel(provider: ProviderCard, label: "Microsoft 365" | "Outlook") {
  if (provider.disabled) return provider.actionLabel;
  if (provider.status === "Connected") return `Reconnect ${label}`;
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

function EmailLogCard({ draftTemplates, emailLog }: { draftTemplates: DraftTemplate[]; emailLog: EmailLog }) {
  const recipientEmail = primaryEmailForDraft(emailLog.direction, emailLog.fromText, emailLog.toText);
  const followUpHref = emailLogFollowUpHref(emailLog);
  return (
    <article className="email-command-card">
      <div className="email-command-card-header">
        <div>
          <h3>{emailLog.subject}</h3>
          <p className="muted">
            {emailLog.direction === "INBOUND" ? "From" : "To"} {emailLog.direction === "INBOUND" ? emailLog.fromText ?? "Not recorded" : emailLog.toText ?? "Not recorded"} ·{" "}
            {formatDate(emailLog.occurredAt)}
          </p>
        </div>
        <span className="badge">{formatEmailProvider(emailLog.provider)}</span>
      </div>
      <div className="filter-actions">
        {emailStatusBadges(emailLog).map((badge) => (
          <span className="badge" key={badge}>
            {badge}
          </span>
        ))}
      </div>
      <p className="email-preview">{formatEmailPreview(emailLog.body)}</p>
      <EmailLogLinks emailLog={emailLog} />
      <div className="filter-actions">
        {followUpHref ? (
          <Link className="button-secondary button-compact" href={followUpHref}>
            Add follow-up
          </Link>
        ) : null}
        {emailLog.person ? (
          <Link className="button-secondary button-compact" href={"/deals/new" as Route}>
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
      </div>
    </article>
  );
}

function EmailPreviewCard({ draftTemplates, preview }: { draftTemplates: DraftTemplate[]; preview: EmailSyncPreview }) {
  const name = displayNameFromParticipant(preview.direction === "INBOUND" ? preview.fromText : preview.toText);
  const contactHref = buildContactHref(preview.email, name);
  const leadHref = buildLeadHref(preview.email, preview.subject);
  return (
    <article className="email-command-card email-command-card-unmatched">
      <div className="email-command-card-header">
        <div>
          <h3>{preview.subject}</h3>
          <p className="muted">
            {preview.direction === "INBOUND" ? "From" : "To"} {preview.direction === "INBOUND" ? preview.fromText ?? preview.email ?? "Unknown" : preview.toText ?? preview.email ?? "Unknown"} ·{" "}
            {formatDate(preview.occurredAt)}
          </p>
        </div>
        <span className="badge">{formatEmailProvider(preview.provider)}</span>
      </div>
      <div className="filter-actions">
        <span className="badge">Unmatched</span>
        <span className="badge">Possible new contact</span>
        {preview.direction === "INBOUND" ? <span className="badge">Follow-up suggested</span> : null}
      </div>
      {preview.snippet ? <p className="email-preview">{preview.snippet}</p> : null}
      <div className="filter-actions">
        <Link className="button-secondary button-compact" href={contactHref}>
          Create contact
        </Link>
        <Link className="button-secondary button-compact" href={leadHref}>
          Create lead
        </Link>
        <span className="muted">Ignore for now</span>
      </div>
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

function emailLogFollowUpHref(emailLog: EmailLog) {
  const title = emailLog.subject ? `Follow up: ${emailLog.subject}` : "Email follow-up";
  if (emailLog.deal) {
    return buildActivityFollowUpHref({ related: { type: "deal", id: emailLog.deal.id }, title, type: "EMAIL" });
  }
  if (emailLog.lead) {
    return buildActivityFollowUpHref({ related: { type: "lead", id: emailLog.lead.id }, title, type: "EMAIL" });
  }
  if (emailLog.person) {
    return buildActivityFollowUpHref({ related: { type: "person", id: emailLog.person.id }, title, type: "EMAIL" });
  }
  if (emailLog.organization) {
    return buildActivityFollowUpHref({
      related: { type: "organization", id: emailLog.organization.id },
      title,
      type: "EMAIL"
    });
  }
  return null;
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
          label: [emailLog.person.firstName, emailLog.person.lastName].filter(Boolean).join(" ")
        }
      : null,
    emailLog.organization
      ? {
          href: `/organizations/${emailLog.organization.id}` as Route,
          label: emailLog.organization.name
        }
      : null,
    emailLog.deal
      ? {
          href: `/deals/${emailLog.deal.id}` as Route,
          label: emailLog.deal.title
        }
      : null,
    emailLog.lead
      ? {
          href: `/leads/${emailLog.lead.id}` as Route,
          label: emailLog.lead.title
        }
      : null
  ].filter((link): link is { href: Route; label: string } => Boolean(link));

  if (links.length === 0) return <span className="muted">No linked CRM record</span>;

  return (
    <div className="filter-actions">
      {links.map((link) => (
        <Link className="inline-link" href={link.href} key={`${link.href}-${link.label}`}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}
