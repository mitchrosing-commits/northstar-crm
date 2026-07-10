import type { Route } from "next";
import Link from "next/link";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarCheck,
  CalendarPlus,
  CircleDollarSign,
  Contact,
  FileText,
  Inbox,
  LayoutDashboard,
  Package,
  PanelsTopLeft,
  Search,
  Settings,
  SlidersHorizontal,
  type LucideIcon
} from "lucide-react";
import { useId } from "react";

import { ActionGroup } from "@/components/action-group";
import { AppShell } from "@/components/app-shell";
import { AssistantIcon } from "@/components/assistant-icon";
import { formatActivityDueBadgeLabel } from "@/components/activity-due-badge";
import { EmptyState } from "@/components/empty-state";
import { formatActivityType, formatDate, formatMoney } from "@/components/format";
import { ListRowActions } from "@/components/list-row-actions";
import { ListViewStatus } from "@/components/list-view-status";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatusBadge } from "@/components/status-badge";
import { classifyActivityDue } from "@/lib/activity-due";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getCrmCreateActionDefinition, type CrmCreateActionPath } from "@/lib/create-record-actions";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { getSearchParam, type ListSearchParams } from "@/lib/list-page-query";
import { appShellNavigationManifest, type AppNavigationIconName } from "@/lib/navigation";
import { formatPersonName } from "@/lib/person-name";
import { recordOwnerLabel } from "@/lib/record-owner-label";
import {
  buildSearchCreateActions,
  buildSearchJumpActions,
  buildSearchListActions,
  queryListHref,
  searchReturnHref
} from "@/lib/search-create-actions";
import { searchCrm } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type SearchActionKind = "create" | "jump" | "list";

const searchNavigationIcons: Record<AppNavigationIconName, LucideIcon> = {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarCheck,
  CalendarPlus,
  CircleDollarSign,
  Contact,
  FileText,
  Inbox,
  LayoutDashboard,
  NorthstarAssistant: AssistantIcon,
  Package,
  PanelsTopLeft,
  Search,
  Settings,
  SlidersHorizontal
};

const searchCreateActionIcons: Record<CrmCreateActionPath, LucideIcon> = {
  "/deals/new": CircleDollarSign,
  "/contacts/new": Contact,
  "/organizations/new": Building2,
  "/leads/new": Contact,
  "/activities/new": CalendarPlus
};

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = getSearchParam(params, "q");
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const results = await searchCrm({ workspaceId: workspace.id, actorUserId }, q);
  const hasQuery = results.query.length > 0;
  const shownResults =
    results.deals.length +
    results.leads.length +
    results.people.length +
    results.organizations.length +
    results.activities.length +
    results.notes.length +
    results.quotes.length +
    results.emailLogs.length;
  const resultOverview = [
    { id: "search-deals", label: "Deals", count: results.deals.length },
    { id: "search-leads", label: "Leads", count: results.leads.length },
    { id: "search-contacts", label: "Contacts", count: results.people.length },
    { id: "search-organizations", label: "Organizations", count: results.organizations.length },
    { id: "search-activities", label: "Activities", count: results.activities.length },
    { id: "search-notes", label: "Notes", count: results.notes.length },
    { id: "search-quotes", label: "Quotes", count: results.quotes.length },
    { id: "search-emails", label: "Emails", count: results.emailLogs.length }
  ];
  const searchSubmitLabel = hasQuery
    ? `Search workspace records for ${results.query}`
    : "Search workspace records";

  return (
    <AppShell globalSearchDefaultValue={hasQuery ? results.query : undefined} workspace={workspace}>
      <PageHeader
        eyebrow="Workspace search"
        subtitle={
          hasQuery
            ? `${shownResults} quick ${shownResults === 1 ? "match" : "matches"} shown for "${results.query}"`
            : "Find records, open filtered lists, and jump into common CRM actions."
        }
        title="Search"
      >
        <ListViewStatus active={hasQuery} label="Search active" resetHref="/search" resetLabel="Clear search" />
      </PageHeader>

      <section className="data-card" aria-labelledby="workspace-search-heading">
        <form action="/search" aria-describedby="workspace-search-helper" className="search-form" role="search">
          <label className="search-field">
            <span id="workspace-search-heading">Search workspace records</span>
            <input
              autoFocus
              defaultValue={results.query}
              name="q"
              placeholder="Search names, titles, domains, quote numbers, email subjects..."
              type="search"
            />
          </label>
          <p className="sr-only" id="workspace-search-helper">
            Search across workspace records. Submit an empty search to return to the unfiltered search page.
          </p>
          <button aria-label={searchSubmitLabel} className="button-primary" title={searchSubmitLabel} type="submit">
            <Search size={16} aria-hidden="true" />
            Search
          </button>
        </form>
      </section>

      {!hasQuery ? <SearchActionPanel /> : null}

      {!hasQuery ? (
        <EmptyState
          as="section"
          description="Enter a name, title, domain, quote number, email subject, activity, or internal note text to find matching CRM records."
          title="Search your workspace"
          titleLevel="h2"
        />
      ) : shownResults === 0 ? (
        <EmptyState
          actions={
            <SearchEmptyActions query={results.query} />
          }
          as="section"
          description={
            <>
              No workspace records matched “{results.query}”. Try a record name, email, domain, quote number, activity
              title, email subject, or note text.
            </>
          }
          title="No results found"
          titleLevel="h2"
        />
      ) : (
        <>
          <SearchResultOverview items={resultOverview} />
          <div className="search-results">
          <SearchSection id="search-deals" title="Deals" count={results.deals.length}>
            {results.deals.map((deal) => (
              <ResultRow
                href={`/deals/${deal.id}` as Route}
                key={deal.id}
                meta={[
                  formatMoney(deal.valueCents, deal.currency),
                  deal.stage.name,
                  recordOwnerLabel(deal.owner),
                  deal.organization?.name,
                  formatPersonName(deal.person)
                ]}
                openLabel="Open deal"
                relatedHref={queryListHref("/deals", deal.title)}
                relatedLabel="Find deals"
                title={deal.title}
                actions={
                  deal.status === "OPEN"
                    ? [
                        {
                          href: buildActivityFollowUpHref({
                            related: { type: "deal", id: deal.id },
                            returnTo: searchReturnHref(results.query),
                            title: `Follow up: ${deal.title}`
                          }),
                          ariaLabel: `Create follow-up activity for ${deal.title}`,
                          label: "Add activity"
                        }
                      ]
                    : []
                }
              >
                <StatusBadge status={deal.status} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection id="search-leads" title="Leads" count={results.leads.length}>
            {results.leads.map((lead) => (
              <ResultRow
                href={`/leads/${lead.id}` as Route}
                key={lead.id}
                meta={[
                  lead.source ? `Source: ${lead.source}` : null,
                  recordOwnerLabel(lead.owner),
                  lead.organization?.name,
                  formatPersonName(lead.person)
                ]}
                openLabel="Open lead"
                relatedHref={queryListHref("/leads", lead.title)}
                relatedLabel="Find leads"
                title={lead.title}
                actions={
                  lead.status !== "CONVERTED"
                    ? [
                        {
                          href: buildActivityFollowUpHref({
                            related: { type: "lead", id: lead.id },
                            returnTo: searchReturnHref(results.query),
                            title: `Follow up: ${lead.title}`
                          }),
                          ariaLabel: `Create follow-up activity for ${lead.title}`,
                          label: "Add activity"
                        }
                      ]
                    : []
                }
              >
                <StatusBadge status={lead.status} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection id="search-contacts" title="Contacts" count={results.people.length}>
            {results.people.map((person) => (
              <ResultRow
                href={`/contacts/${person.id}` as Route}
                key={person.id}
                meta={[person.email, person.phone, recordOwnerLabel(person.owner), person.organization?.name]}
                openLabel="Open contact"
                relatedHref={queryListHref("/contacts", formatPersonName(person) ?? person.email ?? "")}
                relatedLabel="Find contacts"
                title={formatPersonName(person) ?? "Unnamed contact"}
                actions={[
                  {
                    href: buildActivityFollowUpHref({
                      related: { type: "person", id: person.id },
                      returnTo: searchReturnHref(results.query),
                      title: `Follow up: ${formatPersonName(person) ?? person.email ?? "Contact"}`
                    }),
                    ariaLabel: `Create follow-up activity for ${formatPersonName(person) ?? person.email ?? "contact"}`,
                    label: "Add activity"
                  }
                ]}
              />
            ))}
          </SearchSection>

          <SearchSection id="search-organizations" title="Organizations" count={results.organizations.length}>
            {results.organizations.map((organization) => (
              <ResultRow
                href={`/organizations/${organization.id}` as Route}
                key={organization.id}
                meta={[organization.domain, recordOwnerLabel(organization.owner)]}
                openLabel="Open account"
                relatedHref={queryListHref("/organizations", organization.name)}
                relatedLabel="Find accounts"
                title={organization.name}
                actions={[
                  {
                    href: buildActivityFollowUpHref({
                      related: { type: "organization", id: organization.id },
                      returnTo: searchReturnHref(results.query),
                      title: `Follow up: ${organization.name}`
                    }),
                    ariaLabel: `Create follow-up activity for ${organization.name}`,
                    label: "Add activity"
                  }
                ]}
              />
            ))}
          </SearchSection>

          <SearchSection id="search-activities" title="Activities" count={results.activities.length}>
            {results.activities.map((activity) => (
              <ResultRow
                href={activityTarget(activity, results.query)}
                key={activity.id}
                meta={[
                  `Activity: ${formatActivityType(activity.type)}`,
                  activityDueSearchLabel(activity),
                  recordOwnerLabel(activity.owner),
                  attachedLabel(activity)
                ]}
                openLabel="Open activity"
                relatedHref={queryListHref("/activities", activity.title)}
                relatedLabel="Find activities"
                title={activity.title}
              >
                <StatusBadge status={activity.completedAt ? "COMPLETED" : "OPEN"} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection id="search-notes" title="Notes" count={results.notes.length}>
            {results.notes.map((note) => (
              <ResultRow
                href={noteTarget(note)}
                key={note.id}
                meta={[`Internal note added ${formatDate(note.createdAt)}`, noteAuthorLabel(note), attachedLabel(note)]}
                openLabel="Open note context"
                title={notePreview(note.body)}
              />
            ))}
          </SearchSection>

          <SearchSection id="search-quotes" title="Quotes" count={results.quotes.length}>
            {results.quotes.map((quote) => (
              <ResultRow
                href={`/deals/${quote.dealId}/quotes/${quote.id}` as Route}
                key={quote.id}
                meta={[
                  `Deal: ${quote.deal.title}`,
                  recordOwnerLabel(quote.deal.owner),
                  quote.deal.organization?.name,
                  formatPersonName(quote.deal.person),
                  formatMoney(quote.totalCents, quote.currency)
                ]}
                openLabel="Open quote"
                relatedHref={queryListHref("/deals", quote.deal.title)}
                relatedLabel="Find deal"
                title={quote.number}
              >
                <StatusBadge status={quote.status} />
              </ResultRow>
            ))}
          </SearchSection>

          <SearchSection id="search-emails" title="Emails" count={results.emailLogs.length}>
            {results.emailLogs.map((emailLog) => (
              <ResultRow
                href={emailLogTarget(emailLog)}
                key={emailLog.id}
                meta={[
                  emailLog.direction === "INBOUND" ? `From: ${emailLog.fromText ?? "Not recorded"}` : `To: ${emailLog.toText ?? "Not recorded"}`,
                  formatDate(emailLog.occurredAt),
                  attachedLabel(emailLog)
                ]}
                openLabel="Open email context"
                relatedHref={queryListHref("/contacts", emailSearchContactQuery(emailLog))}
                relatedLabel="Find contact"
                title={`Email: ${emailLog.subject}`}
              >
                <StatusBadge status={emailLog.provider ? "SYNCED" : "MANUAL"} />
              </ResultRow>
            ))}
          </SearchSection>
          </div>
        </>
      )}
      {hasQuery ? <SearchActionPanel query={results.query} /> : null}
    </AppShell>
  );
}

function SearchResultOverview({ items }: { items: Array<{ count: number; id: string; label: string }> }) {
  return (
    <section className="data-card search-result-overview" aria-label="Search quick matches shown by record type">
      {items.map((item) =>
        item.count > 0 ? (
          <Link
            aria-label={searchResultOverviewLabel(item)}
            className="search-result-overview-item"
            href={`#${item.id}` as Route}
            key={item.id}
            title={searchResultOverviewLabel(item)}
          >
            <strong>{item.count}</strong>
            <span>{item.label}</span>
          </Link>
        ) : (
          <span
            aria-label={searchResultOverviewLabel(item)}
            className="search-result-overview-item search-result-overview-item-muted"
            key={item.id}
            title={searchResultOverviewLabel(item)}
          >
            <strong>{item.count}</strong>
            <span>{item.label}</span>
          </span>
        )
      )}
    </section>
  );
}

function searchResultOverviewLabel(item: { count: number; label: string }) {
  return `${item.count} ${item.label.toLowerCase()} quick ${item.count === 1 ? "match" : "matches"} shown`;
}

function SearchEmptyActions({ query }: { query: string }) {
  const createActions = buildSearchCreateActions(query);
  const listActions = buildSearchListActions(query);
  const clearSearchLabel = "Clear search and show workspace search actions";
  const createActionsLabel = `Create CRM records from "${query}"`;
  const listActionsLabel = `Open filtered CRM lists for "${query}"`;

  return (
    <>
      <ActionGroup className="search-empty-create-actions" label={createActionsLabel}>
        {createActions.map((action, index) => {
          const actionLabel = `${action.label}: ${action.description}`;

          return (
            <Link
              aria-label={actionLabel}
              className={index === 0 ? "button-primary" : "button-secondary"}
              href={action.href}
              key={action.label}
              title={actionLabel}
            >
              {action.label}
            </Link>
          );
        })}
      </ActionGroup>
      <ActionGroup className="search-empty-list-actions" label={listActionsLabel}>
        <span>Search lists</span>
        {listActions.map((action) => {
          const actionLabel = `${action.label}: ${action.description}`;

          return (
            <Link
              aria-label={actionLabel}
              className="button-secondary button-compact"
              href={action.href}
              key={action.label}
              title={actionLabel}
            >
              {action.label}
            </Link>
          );
        })}
      </ActionGroup>
      <Link aria-label={clearSearchLabel} className="button-secondary" href="/search" title={clearSearchLabel}>
        Clear search
      </Link>
    </>
  );
}

function SearchActionPanel({ query }: { query?: string }) {
  const hasQuery = Boolean(query?.trim());
  const listActions = buildSearchListActions(query);
  const createActions = buildSearchCreateActions(query);
  const jumpActions = buildSearchJumpActions();

  return (
    <section className="data-card search-action-panel" aria-label="Search actions">
      <SearchActionGroup
        actions={listActions}
        eyebrow={hasQuery ? "Open filtered lists" : "Browse records"}
        headingId="search-list-actions-heading"
        kind="list"
        title={hasQuery ? "Use this query elsewhere" : "Jump to a CRM list"}
      />
      <SearchActionGroup
        actions={createActions}
        eyebrow="Create"
        headingId="search-create-actions-heading"
        kind="create"
        title="Start a record"
      />
      <SearchActionGroup
        actions={jumpActions}
        eyebrow="Jump"
        headingId="search-jump-actions-heading"
        kind="jump"
        title="Go to workspace areas"
      />
    </section>
  );
}

function SearchActionGroup({
  actions,
  eyebrow,
  headingId,
  kind,
  title
}: {
  actions: Array<{ description: string; href: Route; label: string }>;
  eyebrow: string;
  headingId: string;
  kind: SearchActionKind;
  title: string;
}) {
  return (
    <section className="search-action-group" aria-labelledby={headingId}>
      <p className="search-action-eyebrow">{eyebrow}</p>
      <h2 id={headingId}>{title}</h2>
      <div className="search-action-links">
        {actions.map((action) => {
          const actionLabel = `${action.label}: ${action.description}`;
          const Icon = searchActionIcon(kind, action.href);

          return (
            <Link
              aria-label={actionLabel}
              className="search-action-link"
              href={action.href}
              key={action.label}
              title={actionLabel}
            >
              <span className="search-action-link-icon">
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="search-action-link-copy">
                <strong>{action.label}</strong>
                <span>{action.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function searchActionIcon(kind: SearchActionKind, href: Route) {
  const basePath = String(href).split("?")[0] as Route;
  if (kind === "create") return searchCreateActionIcons[getCrmCreateActionDefinition(href).href];

  const navigationItem = appShellNavigationManifest.find((item) => item.href === basePath);
  return navigationItem ? searchNavigationIcons[navigationItem.icon] : Search;
}

function SearchSection({
  id,
  title,
  count,
  children
}: {
  children: React.ReactNode;
  count: number;
  id: string;
  title: string;
}) {
  const titleId = `${useId()}-search-section-title`;
  if (count === 0) return null;
  const countLabel = `${count} ${title.toLowerCase()} quick ${count === 1 ? "match" : "matches"} shown`;

  return (
    <section aria-labelledby={titleId} className="data-card search-section" id={id}>
      <PanelTitleRow
        actions={<span aria-label={countLabel} className="search-count" title={countLabel}>{count}</span>}
        actionsLabel={countLabel}
        title={title}
        titleId={titleId}
      />
      <div className="result-list">{children}</div>
    </section>
  );
}

function ResultRow({
  href,
  title,
  meta,
  openLabel = "Open",
  actions = [],
  relatedHref,
  relatedLabel = "Find related",
  children
}: {
  actions?: Array<{ ariaLabel?: string; href: Route; label: string }>;
  href: Route;
  title: string;
  meta: Array<string | null | undefined>;
  openLabel?: string;
  relatedHref?: Route;
  relatedLabel?: string;
  children?: React.ReactNode;
}) {
  const openActionLabel = openLabel === "Open" ? `Open ${title}` : `${openLabel}: ${title}`;
  const rowActions = [
    { href, label: openLabel, ariaLabel: openActionLabel },
    ...actions,
    ...(relatedHref ? [{ href: relatedHref, label: relatedLabel, ariaLabel: `${relatedLabel} matching ${title}` }] : [])
  ];

  return (
    <div className="result-row">
      <Link aria-label={openActionLabel} className="result-row-main-link" href={href} title={openActionLabel}>
        <span className="table-primary-cell search-result-main">
          <strong>{title}</strong>
          <span className="table-secondary-text search-result-meta">
            {meta.filter(Boolean).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </span>
        </span>
      </Link>
      <div className="search-result-side">
        {children ? <span className="search-result-status">{children}</span> : null}
        <div className="result-row-actions">
          <ListRowActions aria-label={`${title} search result actions`} actions={rowActions} />
        </div>
      </div>
    </div>
  );
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

function activityDueSearchLabel(activity: { dueAt: Date | string | null; completedAt: Date | string | null }) {
  return formatActivityDueBadgeLabel(classifyActivityDue(activity), activity);
}

function activityTarget(activity: {
  id: string;
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}, query: string) {
  const params = new URLSearchParams({ returnTo: searchReturnHref(query) });
  return `/activities/${activity.id}/edit?${params.toString()}` as Route;
}

function noteTarget(note: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}) {
  return attachmentTarget(note, "#notes");
}

function emailLogTarget(emailLog: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}) {
  return attachmentTarget(emailLog, "#email-log");
}

function emailSearchContactQuery(emailLog: {
  fromText: string | null;
  person?: { firstName: string; lastName: string | null; email: string | null } | null;
  toText: string | null;
}) {
  return formatPersonName(emailLog.person) ?? emailLog.person?.email ?? emailLog.fromText ?? emailLog.toText ?? "";
}

function attachmentTarget(record: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}, fragment = ""): Route {
  if (record.dealId) return `/deals/${record.dealId}${fragment}` as Route;
  if (record.leadId) return `/leads/${record.leadId}${fragment}` as Route;
  if (record.personId) return `/contacts/${record.personId}${fragment}` as Route;
  if (record.organizationId) return `/organizations/${record.organizationId}${fragment}` as Route;
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
  if (record.person) return `Contact: ${formatPersonName(record.person) ?? "Unnamed contact"}`;
  if (record.organization) return `Organization: ${record.organization.name}`;
  return null;
}
