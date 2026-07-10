import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { formatDate } from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWebFormReview } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ webFormId: string }>;
  searchParams?: Promise<{
    from?: string | string[];
    q?: string | string[];
    status?: string | string[];
    to?: string | string[];
  }>;
};
type WebFormReviewResult = Awaited<ReturnType<typeof getWebFormReview>>;

const LEAD_STATUS_OPTIONS = [
  { label: "New", value: "NEW" },
  { label: "Qualified", value: "QUALIFIED" },
  { label: "Disqualified", value: "DISQUALIFIED" },
  { label: "Converted", value: "CONVERTED" }
];

export default async function WebFormReviewPage({ params, searchParams }: PageProps) {
  const { webFormId } = await params;
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const webForm = await getWebFormReview(actor, webFormId, query).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const latestSubmission = webForm.latestSubmissionAt;
  const filterEntries = activeFilterEntries(webForm.filters);
  const showingCount = webForm.submissions.length;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link className="button-secondary" href="/web-forms">
            Back to Web Forms
          </Link>
        }
        eyebrow="Lead capture review"
        subtitle="Review accepted public submissions and follow the linked leads. Suppressed duplicate and honeypot attempts are not shown because their payloads are not stored."
        title={webForm.name}
      />

      <section className="panel section-separated">
        <PanelTitleRow
          actions={<Badge label={`Web form status: ${webForm.isEnabled ? "Enabled" : "Disabled"}`}>{webForm.isEnabled ? "Enabled" : "Disabled"}</Badge>}
          description={webForm.publicDescription ?? "No public description configured."}
          title="Form Summary"
        />
        <dl className="web-form-review-summary" aria-label="Web form submission summary">
          <div>
            <dt>Accepted submissions</dt>
            <dd>{webForm._count.submissions}</dd>
          </div>
          <div>
            <dt>Latest accepted activity</dt>
            <dd>{latestSubmission ? formatDateTime(latestSubmission) : "No submissions yet"}</dd>
          </div>
          <div>
            <dt>Lead source</dt>
            <dd>{webForm.sourceLabel}</dd>
          </div>
          <div>
            <dt>Lead title</dt>
            <dd>{webForm.requireLeadTitle ? "Required" : "Optional"}</dd>
          </div>
          <div>
            <dt>Public title</dt>
            <dd>{webForm.publicTitle}</dd>
          </div>
          <div>
            <dt>Last edited</dt>
            <dd>{formatDate(webForm.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          description="Search accepted submissions by submitter details or linked lead title. Filters are saved in the URL for sharing and refresh."
          title="Filter Submissions"
        />
        <form className="filter-form" method="get">
          <fieldset className="filter-fieldset">
            <div className="filter-form-grid web-form-filter-grid">
              <label className="form-field">
                <span>Search</span>
                <input
                  defaultValue={webForm.filters.query ?? ""}
                  maxLength={120}
                  name="q"
                  placeholder="Name, email, company, phone, or lead"
                  type="search"
                />
              </label>
              <label className="form-field">
                <span>From</span>
                <input defaultValue={webForm.filters.from ?? ""} name="from" type="date" />
              </label>
              <label className="form-field">
                <span>To</span>
                <input defaultValue={webForm.filters.to ?? ""} name="to" type="date" />
              </label>
              <label className="form-field">
                <span>Lead status</span>
                <select defaultValue={webForm.filters.status ?? ""} name="status">
                  <option value="">Any status</option>
                  {LEAD_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="filter-actions">
                <button className="button-primary button-compact" type="submit">
                  Apply filters
                </button>
                {webForm.hasActiveFilters ? (
                  <Link className="button-secondary button-compact" href={`/web-forms/${webForm.id}` as Route}>
                    Clear filters
                  </Link>
                ) : null}
              </div>
            </div>
          </fieldset>
        </form>
        <div className="web-form-filter-state" aria-label="Active submission filters">
          {filterEntries.length > 0 ? (
            filterEntries.map((entry) => (
              <span className="badge" key={entry.label}>
                {entry.label}: {entry.value}
              </span>
            ))
          ) : (
            <span className="table-secondary-text">No active filters</span>
          )}
        </div>
      </section>

      {webForm.submissions.length > 0 ? (
        <section className="panel" id="accepted-submissions" tabIndex={-1}>
          <PanelTitleRow
            actions={
              <Badge label={`${showingCount} visible of ${webForm.filteredSubmissionCount} matching submissions`}>
                {showingCount}/{webForm.filteredSubmissionCount}
              </Badge>
            }
            description={`Newest accepted submissions first. Results are capped at ${webForm.submissionLimit}; spam and exact-repeat duplicate payloads are not retained for review.`}
            title="Recent Accepted Submissions"
          />
          <TableScroll aria-label={`${webForm.name} accepted web form submissions`}>
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Submitter Fields</th>
                  <th>Source Form</th>
                  <th>Linked Lead</th>
                  <th>Message</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {webForm.submissions.map((submission) => (
                  <tr key={submission.id}>
                    <td data-label="Submitted">{formatDateTime(submission.submittedAt)}</td>
                    <td data-label="Submitter Fields">
                      <SubmissionFieldList
                        email={submission.email}
                        organizationName={submission.organizationName}
                        personName={submission.personName}
                        phone={submission.phone}
                      />
                    </td>
                    <td data-label="Source Form">
                      <span className="table-primary-cell">
                        <strong>{webForm.name}</strong>
                        <span className="table-secondary-text">{webForm.sourceLabel}</span>
                      </span>
                    </td>
                    <td data-label="Linked Lead">
                      {submission.lead && !submission.lead.deletedAt ? (
                        <Link href={`/leads/${submission.lead.id}` as Route}>{submission.leadTitle ?? submission.lead.title}</Link>
                      ) : (
                        "Lead unavailable"
                      )}
                    </td>
                    <td data-label="Message">
                      {submission.message ? <p className="web-form-submission-message">{submission.message}</p> : "No message"}
                    </td>
                    <td className="table-actions-cell" data-label="Actions">
                      <Link className="button-secondary button-compact" href={submissionDetailHref(submission.id, webForm)}>
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </section>
      ) : (
        <EmptyState
          as="section"
          className="empty-state-panel"
          description={
            webForm.hasActiveFilters && webForm._count.submissions > 0
              ? "Adjust or clear the active filters to review more accepted submissions."
              : "Accepted submissions will appear here after visitors submit this public form. Suppressed honeypot and duplicate attempts are intentionally not stored."
          }
          title={webForm.hasActiveFilters && webForm._count.submissions > 0 ? "No submissions match these filters" : "No submissions yet"}
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function submissionDetailHref(submissionId: string, webForm: WebFormReviewResult) {
  const returnTo = buildFormReviewReturnHref(webForm);
  return `/web-forms/submissions/${submissionId}?returnTo=${encodeURIComponent(returnTo)}` as Route;
}

function buildFormReviewReturnHref(webForm: WebFormReviewResult) {
  const params = new URLSearchParams();
  if (webForm.filters.query) params.set("q", webForm.filters.query);
  if (webForm.filters.from) params.set("from", webForm.filters.from);
  if (webForm.filters.to) params.set("to", webForm.filters.to);
  if (webForm.filters.status) params.set("status", webForm.filters.status);
  const suffix = params.toString();
  return `/web-forms/${webForm.id}${suffix ? `?${suffix}` : ""}#accepted-submissions`;
}

function activeFilterEntries(filters: {
  from: string | null;
  query: string | null;
  status: string | null;
  to: string | null;
}) {
  return [
    filters.query ? { label: "Search", value: filters.query } : null,
    filters.from ? { label: "From", value: filters.from } : null,
    filters.to ? { label: "To", value: filters.to } : null,
    filters.status ? { label: "Lead status", value: leadStatusLabel(filters.status) } : null
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));
}

function leadStatusLabel(status: string) {
  return LEAD_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function SubmissionFieldList({
  email,
  organizationName,
  personName,
  phone
}: {
  email: string | null;
  organizationName: string | null;
  personName: string | null;
  phone: string | null;
}) {
  const fields = [
    ["Name", personName],
    ["Email", email],
    ["Phone", phone],
    ["Company", organizationName]
  ].filter((item): item is [string, string] => Boolean(item[1]));

  if (fields.length === 0) return "No contact fields";

  return (
    <dl className="web-form-submission-fields">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
