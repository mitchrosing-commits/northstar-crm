import type { Route } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { formatActivityType, formatDate, formatMoney } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { searchCrm } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const { q = "" } = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const results = await searchCrm({ workspaceId: workspace.id, actorUserId }, q);
  const hasQuery = results.query.length > 0;
  const totalResults =
    results.deals.length +
    results.leads.length +
    results.people.length +
    results.organizations.length +
    results.activities.length +
    results.notes.length +
    results.quotes.length +
    results.emailLogs.length;

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Workspace search</p>
          <h1 className="page-title">Search</h1>
        </div>
      </header>

      <section className="data-card">
        <form action="/search" className="search-form">
          <label className="search-field">
            <span>Search workspace records</span>
            <input
              autoFocus
              defaultValue={results.query}
              name="q"
              placeholder="Search deals, leads, contacts, activities, notes..."
            />
          </label>
          <button className="button-primary" type="submit">
            <Search size={16} aria-hidden="true" />
            Search
          </button>
        </form>
      </section>

      {!hasQuery ? (
        <section className="empty-state">
          <h2>Search your workspace</h2>
          <p>Enter a name, title, domain, quote number, email subject, activity, or internal note text to find matching CRM records.</p>
          <div className="filter-actions">
            <Link className="button-secondary button-compact" href="/deals/new">
              Create deal
            </Link>
            <Link className="button-secondary button-compact" href="/contacts/new">
              Add contact
            </Link>
            <Link className="button-secondary button-compact" href="/organizations/new">
              Add organization
            </Link>
            <Link className="button-secondary button-compact" href="/leads/new">
              Add lead
            </Link>
          </div>
        </section>
      ) : totalResults === 0 ? (
        <section className="empty-state">
          <h2>No results found</h2>
          <p>
            No workspace records matched “{results.query}”. Try a record name, email, domain, quote number, activity title,
            email subject, or note text.
          </p>
          <div className="filter-actions">
            <Link className="button-secondary button-compact" href="/deals/new">
              Create deal
            </Link>
            <Link className="button-secondary button-compact" href="/contacts/new">
              Add contact
            </Link>
            <Link className="button-secondary button-compact" href="/organizations/new">
              Add organization
            </Link>
            <Link className="button-secondary button-compact" href="/leads/new">
              Add lead
            </Link>
          </div>
        </section>
      ) : (
        <div className="search-results">
          <SearchSection title="Deals" count={results.deals.length}>
            {results.deals.map((deal) => (
              <ResultRow
                href={`/deals/${deal.id}` as Route}
                key={deal.id}
                meta={[
                  formatMoney(deal.valueCents, deal.currency),
                  deal.stage.name,
                  deal.organization?.name,
                  formatPersonName(deal.person)
                ]}
                title={deal.title}
              >
                <StatusBadge status={deal.status} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection title="Leads" count={results.leads.length}>
            {results.leads.map((lead) => (
              <ResultRow
                href={`/leads/${lead.id}` as Route}
                key={lead.id}
                meta={[lead.source ? `Source: ${lead.source}` : null, lead.organization?.name, formatPersonName(lead.person)]}
                title={lead.title}
              >
                <StatusBadge status={lead.status} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection title="Contacts" count={results.people.length}>
            {results.people.map((person) => (
              <ResultRow
                href={`/contacts/${person.id}` as Route}
                key={person.id}
                meta={[person.email, person.phone, person.organization?.name]}
                title={formatPersonName(person) ?? "Unnamed contact"}
              />
            ))}
          </SearchSection>

          <SearchSection title="Organizations" count={results.organizations.length}>
            {results.organizations.map((organization) => (
              <ResultRow
                href={`/organizations/${organization.id}` as Route}
                key={organization.id}
                meta={[organization.domain]}
                title={organization.name}
              />
            ))}
          </SearchSection>

          <SearchSection title="Activities" count={results.activities.length}>
            {results.activities.map((activity) => (
              <ResultRow
                href={activityTarget(activity)}
                key={activity.id}
                meta={[
                  `Activity: ${formatActivityType(activity.type)}`,
                  activity.completedAt ? `Completed ${formatDate(activity.completedAt)}` : activityDueLabel(activity.dueAt),
                  attachedLabel(activity)
                ]}
                title={activity.title}
              >
                <StatusBadge status={activity.completedAt ? "COMPLETED" : "OPEN"} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection title="Notes" count={results.notes.length}>
            {results.notes.map((note) => (
              <ResultRow
                href={noteTarget(note)}
                key={note.id}
                meta={[`Internal note added ${formatDate(note.createdAt)}`, noteAuthorLabel(note), attachedLabel(note)]}
                title={notePreview(note.body)}
              />
            ))}
          </SearchSection>

          <SearchSection title="Quotes" count={results.quotes.length}>
            {results.quotes.map((quote) => (
              <ResultRow
                href={`/deals/${quote.dealId}/quotes/${quote.id}` as Route}
                key={quote.id}
                meta={[
                  `Deal: ${quote.deal.title}`,
                  quote.deal.organization?.name,
                  formatPersonName(quote.deal.person),
                  formatMoney(quote.totalCents, quote.currency)
                ]}
                title={quote.number}
              >
                <StatusBadge status={quote.status} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection title="Emails" count={results.emailLogs.length}>
            {results.emailLogs.map((emailLog) => (
              <ResultRow
                href={emailLogTarget(emailLog)}
                key={emailLog.id}
                meta={[
                  emailLog.direction === "INBOUND" ? `From: ${emailLog.fromText ?? "Not recorded"}` : `To: ${emailLog.toText ?? "Not recorded"}`,
                  formatDate(emailLog.occurredAt),
                  attachedLabel(emailLog)
                ]}
                title={`Email: ${emailLog.subject}`}
              >
                <StatusBadge status={emailLog.provider ? "SYNCED" : "MANUAL"} />
              </ResultRow>
            ))}
          </SearchSection>
        </div>
      )}
    </AppShell>
  );
}

function SearchSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;

  return (
    <section className="data-card search-section">
      <div className="section-heading">
        <h2 className="panel-title">{title}</h2>
        <span className="search-count">{count}</span>
      </div>
      <div className="result-list">{children}</div>
    </section>
  );
}

function ResultRow({
  href,
  title,
  meta,
  children
}: {
  href: Route;
  title: string;
  meta: Array<string | null | undefined>;
  children?: React.ReactNode;
}) {
  return (
    <Link className="result-row" href={href}>
      <div>
        <strong>{title}</strong>
        <div className="deal-meta">
          {meta.filter(Boolean).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
      {children}
    </Link>
  );
}

function formatPersonName(person?: { firstName: string; lastName: string | null } | null) {
  if (!person) return null;
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function preview(body: string) {
  return body.length > 120 ? `${body.slice(0, 117)}...` : body;
}

function notePreview(body: string) {
  return `Note: ${preview(body)}`;
}

function noteAuthorLabel(note: { author?: { name: string | null; email: string } | null }) {
  const author = note.author?.name ?? note.author?.email;
  return author ? `Author: ${author}` : "Author: Unknown";
}

function activityDueLabel(dueAt: Date | string | null) {
  return dueAt ? `Due ${formatDate(dueAt)}` : "No due date";
}

function activityTarget(activity: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}) {
  return attachmentTarget(activity);
}

function noteTarget(note: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}) {
  return attachmentTarget(note);
}

function emailLogTarget(emailLog: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}) {
  return attachmentTarget(emailLog);
}

function attachmentTarget(record: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}): Route {
  if (record.dealId) return `/deals/${record.dealId}` as Route;
  if (record.leadId) return `/leads/${record.leadId}` as Route;
  if (record.personId) return `/contacts/${record.personId}` as Route;
  if (record.organizationId) return `/organizations/${record.organizationId}` as Route;
  return "/activities";
}

function attachedLabel(record: {
  deal?: { title: string } | null;
  lead?: { title: string } | null;
  person?: { firstName: string; lastName: string | null } | null;
  organization?: { name: string } | null;
}) {
  if (record.deal) return `Deal: ${record.deal.title}`;
  if (record.lead) return `Lead: ${record.lead.title}`;
  if (record.person) return `Contact: ${formatPersonName(record.person)}`;
  if (record.organization) return `Organization: ${record.organization.name}`;
  return null;
}
