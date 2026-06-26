import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { formatDate } from "@/components/format";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listEmailConnectionProviderCards, listEmailLogs } from "@/lib/services/crm";
import { syncRecentGmailFromEmailPageAction, syncRecentMicrosoftFromEmailPageAction } from "./actions";

export const dynamic = "force-dynamic";

type EmailPageProps = {
  searchParams?: Promise<{
    created?: string;
    duplicates?: string;
    emailConnection?: string;
    skipped?: string;
  }>;
};

export default async function EmailPage({ searchParams }: EmailPageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const [providers, recentEmailLogs] = await Promise.all([
    listEmailConnectionProviderCards(actor),
    listEmailLogs(actor, { limit: 25 })
  ]);
  const gmailProvider = providers.find((provider) => provider.provider === "GOOGLE_WORKSPACE");
  const microsoftProvider = providers.find((provider) => provider.provider === "MICROSOFT_365");
  const imapProvider = providers.find((provider) => provider.provider === "IMAP_SMTP");
  const majorProviderCards = buildMajorProviderCards({ gmailProvider, microsoftProvider });
  const statusCopy = emailStatusCopy(resolvedSearchParams);

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

      <section className="data-card">
        <div className="panel-title-row">
          <h2 className="panel-title">Recent Email Activity</h2>
          <span className="badge">{recentEmailLogs.length} shown</span>
        </div>
        {recentEmailLogs.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Source</th>
                <th>Direction</th>
                <th>From / To</th>
                <th>Occurred</th>
                <th>Linked records</th>
              </tr>
            </thead>
            <tbody>
              {recentEmailLogs.map((emailLog) => (
                <tr key={emailLog.id}>
                  <td>
                    <strong>{emailLog.subject}</strong>
                  </td>
                  <td>
                    <span className="badge">{emailLog.provider === "GOOGLE_WORKSPACE" ? "Gmail" : "Manual"}</span>
                  </td>
                  <td>{emailLog.direction === "INBOUND" ? "Inbound" : "Outbound"}</td>
                  <td>
                    <div>{emailLog.fromText ?? "From not recorded"}</div>
                    <div className="muted">{emailLog.toText ?? "To not recorded"}</div>
                  </td>
                  <td>{formatDate(emailLog.occurredAt)}</td>
                  <td>
                    <EmailLogLinks emailLog={emailLog} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <h3>No email activity yet</h3>
            <p>
              Log an email manually from a deal, contact, organization, or lead. After Gmail is connected, manual sync
              will add recent matched messages from known contacts here.
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
    actionLabel: "Coming soon",
    detail: "Microsoft Graph OAuth and metadata sync are planned, but not live yet.",
    disabled: true,
    name: "Microsoft 365",
    provider: "MICROSOFT_365" as const,
    scopes: [],
    status: "Coming soon"
  };

  return [
    { ...gmailBase, actionLabel: gmailActionLabel(gmailBase, "Gmail"), name: "Gmail" },
    {
      ...gmailBase,
      actionLabel: gmailActionLabel(gmailBase, "Google Workspace"),
      detail:
        gmailBase.status === "Connected"
          ? "Google Workspace mailbox connected through the existing Gmail metadata sync path."
          : "Connect a Google Workspace mailbox through the same Google OAuth and Gmail metadata sync path.",
      name: "Google Workspace"
    },
    {
      ...microsoftBase,
      actionLabel: microsoftActionLabel(microsoftBase, "Microsoft 365"),
      detail: microsoftProviderDetail(microsoftBase, "Microsoft 365"),
      disabled: microsoftBase.disabled,
      href: microsoftBase.href,
      name: "Microsoft 365",
      syncAvailable: microsoftBase.syncAvailable,
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
