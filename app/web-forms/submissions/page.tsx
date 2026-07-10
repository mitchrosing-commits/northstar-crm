import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";
import { AppShell } from "@/components/app-shell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWebFormSubmissionReview } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    form?: string | string[];
    from?: string | string[];
    q?: string | string[];
    status?: string | string[];
    to?: string | string[];
  }>;
};
type SubmissionReviewFilters = Awaited<ReturnType<typeof getWebFormSubmissionReview>>["filters"];

const LEAD_STATUS_OPTIONS = [
  { label: "New", value: "NEW" },
  { label: "Qualified", value: "QUALIFIED" },
  { label: "Disqualified", value: "DISQUALIFIED" },
  { label: "Converted", value: "CONVERTED" }
];

export default async function WebFormSubmissionsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const review = await getWebFormSubmissionReview(actor, query);
  const filterEntries = activeFilterEntries(review.filters, review.webForms);
  const showingCount = review.submissions.length;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link className="button-secondary" href="/web-forms">
            Back to Web Forms
          </Link>
        }
        eyebrow="Lead capture review"
        subtitle="Review accepted public submissions across every active Web Form in this workspace."
        title="Web Form Submissions"
      />

      <section className="panel section-separated">
        <PanelTitleRow description="Accepted submissions are persisted lead-capture rows only." title="Submission Summary" />
        <dl className="web-form-review-summary" aria-label="All web form submission summary">
          <div>
            <dt>Accepted submissions</dt>
            <dd>{review.acceptedSubmissionCount}</dd>
          </div>
          <div>
            <dt>Matching filters</dt>
            <dd>{review.filteredSubmissionCount}</dd>
          </div>
          <div>
            <dt>Visible results</dt>
            <dd>{showingCount}</dd>
          </div>
        </dl>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          description="Search accepted submissions by submitter details, linked Lead title, or form name. Filters are saved in the URL."
          title="Filter Submissions"
        />
        <form className="filter-form" method="get">
          <fieldset className="filter-fieldset">
            <div className="filter-form-grid web-form-filter-grid web-form-all-submissions-filter-grid">
              <label className="form-field">
                <span>Search</span>
                <input
                  defaultValue={review.filters.query ?? ""}
                  maxLength={120}
                  name="q"
                  placeholder="Name, email, company, phone, lead, or form"
                  type="search"
                />
              </label>
              <label className="form-field">
                <span>Source form</span>
                <select defaultValue={review.filters.webFormId ?? ""} name="form">
                  <option value="">All forms</option>
                  {review.webForms.map((webForm) => (
                    <option key={webForm.id} value={webForm.id}>
                      {webForm.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>From</span>
                <input defaultValue={review.filters.from ?? ""} name="from" type="date" />
              </label>
              <label className="form-field">
                <span>To</span>
                <input defaultValue={review.filters.to ?? ""} name="to" type="date" />
              </label>
              <label className="form-field">
                <span>Lead status</span>
                <select defaultValue={review.filters.status ?? ""} name="status">
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
                {review.hasActiveFilters ? (
                  <Link className="button-secondary button-compact" href="/web-forms/submissions">
                    Clear filters
                  </Link>
                ) : null}
              </div>
            </div>
          </fieldset>
        </form>
        <div className="web-form-filter-state" aria-label="Active all-form submission filters">
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

      {review.submissions.length > 0 ? (
        <section className="panel" id="accepted-submissions" tabIndex={-1}>
          <PanelTitleRow
            actions={
              <Badge label={`${showingCount} visible of ${review.filteredSubmissionCount} matching submissions`}>
                {showingCount}/{review.filteredSubmissionCount}
              </Badge>
            }
            description={`Newest accepted submissions first. Results are capped at ${review.submissionLimit}.`}
            title="Accepted Submissions"
          />
          <TableScroll aria-label="All accepted web form submissions">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Source Form</th>
                  <th>Submitter</th>
                  <th>Linked Lead</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {review.submissions.map((submission) => (
                  <tr key={submission.id}>
                    <td data-label="Submitted">{formatDateTime(submission.submittedAt)}</td>
                    <td data-label="Source Form">
                      <span className="table-primary-cell">
                        <Link href={`/web-forms/${submission.webForm.id}` as Route}>{submission.webForm.name}</Link>
                        <span className="table-secondary-text">{submission.webForm.sourceLabel}</span>
                      </span>
                    </td>
                    <td data-label="Submitter">
                      <SubmissionFieldList
                        email={submission.email}
                        organizationName={submission.organizationName}
                        personName={submission.personName}
                        phone={submission.phone}
                      />
                    </td>
                    <td data-label="Linked Lead">
                      {submission.lead && !submission.lead.deletedAt ? (
                        <Link href={`/leads/${submission.lead.id}` as Route}>{submission.leadTitle ?? submission.lead.title}</Link>
                      ) : (
                        "Lead unavailable"
                      )}
                    </td>
                    <td data-label="Status">{submission.lead ? leadStatusLabel(submission.lead.status) : "Unavailable"}</td>
                    <td className="table-actions-cell" data-label="Actions">
                      <Link className="button-secondary button-compact" href={submissionDetailHref(submission.id, review.filters)}>
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
            review.hasActiveFilters && review.acceptedSubmissionCount > 0
              ? "Adjust or clear the active filters to review more accepted submissions."
              : "Accepted submissions from non-deleted Web Forms will appear here after visitors submit public forms."
          }
          title={
            review.hasActiveFilters && review.acceptedSubmissionCount > 0
              ? "No submissions match these filters"
              : "No accepted submissions yet"
          }
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function submissionDetailHref(submissionId: string, filters: SubmissionReviewFilters) {
  const returnTo = buildAllSubmissionsReturnHref(filters);
  return `/web-forms/submissions/${submissionId}?returnTo=${encodeURIComponent(returnTo)}` as Route;
}

function buildAllSubmissionsReturnHref(filters: SubmissionReviewFilters) {
  const params = new URLSearchParams();
  if (filters.webFormId) params.set("form", filters.webFormId);
  if (filters.query) params.set("q", filters.query);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status) params.set("status", filters.status);
  const suffix = params.toString();
  return `/web-forms/submissions${suffix ? `?${suffix}` : ""}#accepted-submissions`;
}

function activeFilterEntries(
  filters: {
    from: string | null;
    query: string | null;
    status: string | null;
    to: string | null;
    webFormId: string | null;
  },
  webForms: Array<{ id: string; name: string }>
) {
  return [
    filters.query ? { label: "Search", value: filters.query } : null,
    filters.webFormId
      ? { label: "Source form", value: webForms.find((webForm) => webForm.id === filters.webFormId)?.name ?? filters.webFormId }
      : null,
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
    ["Company", organizationName],
    ["Phone", phone]
  ].filter((item): item is [string, string] => Boolean(item[1]));

  if (fields.length === 0) return "No submitter fields";

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
