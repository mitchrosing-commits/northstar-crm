import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getSchedulerBookingReview } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    activity?: string | string[];
    from?: string | string[];
    link?: string | string[];
    q?: string | string[];
    to?: string | string[];
  }>;
};
type SchedulerBookingFilters = Awaited<ReturnType<typeof getSchedulerBookingReview>>["filters"];

const ACTIVITY_STATE_OPTIONS = [
  { label: "Activity available", value: "open" },
  { label: "Activity completed", value: "completed" },
  { label: "Activity unavailable", value: "unavailable" }
];

export default async function SchedulerBookingsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const review = await getSchedulerBookingReview(actor, query);
  const filterEntries = activeFilterEntries(review.filters, review.schedulerLinks);
  const showingCount = review.bookings.length;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link className="button-secondary" href="/scheduler">
            Back to Scheduler
          </Link>
        }
        eyebrow="Booking review"
        subtitle="Review accepted Scheduler booking requests across every scheduling link in this workspace."
        title="Scheduler Bookings"
      />

      <section className="panel section-separated">
        <PanelTitleRow description="Accepted bookings are persisted Scheduler booking rows only." title="Booking Summary" />
        <dl className="scheduler-review-summary" aria-label="All scheduler booking summary">
          <div>
            <dt>Accepted bookings</dt>
            <dd>{review.acceptedBookingCount}</dd>
          </div>
          <div>
            <dt>Matching filters</dt>
            <dd>{review.filteredBookingCount}</dd>
          </div>
          <div>
            <dt>Visible results</dt>
            <dd>{showingCount}</dd>
          </div>
        </dl>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          description="Search accepted bookings by attendee details or source link. Filters are saved in the URL."
          title="Filter Bookings"
        />
        <form className="filter-form" method="get">
          <fieldset className="filter-fieldset">
            <div className="filter-form-grid scheduler-booking-filter-grid">
              <label className="form-field">
                <span>Search</span>
                <input
                  defaultValue={review.filters.query ?? ""}
                  maxLength={120}
                  name="q"
                  placeholder="Name, email, company, or source"
                  type="search"
                />
              </label>
              <label className="form-field">
                <span>Source link</span>
                <select defaultValue={review.filters.schedulerLinkId ?? ""} name="link">
                  <option value="">All links</option>
                  {review.schedulerLinks.map((schedulerLink) => (
                    <option key={schedulerLink.id} value={schedulerLink.id}>
                      {schedulerLink.name}
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
                <span>Activity state</span>
                <select defaultValue={review.filters.activity ?? ""} name="activity">
                  <option value="">Any state</option>
                  {ACTIVITY_STATE_OPTIONS.map((option) => (
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
                  <Link className="button-secondary button-compact" href="/scheduler/bookings">
                    Clear filters
                  </Link>
                ) : null}
              </div>
            </div>
          </fieldset>
        </form>
        <div className="web-form-filter-state" aria-label="Active scheduler booking filters">
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

      {review.bookings.length > 0 ? (
        <section className="panel" id="scheduler-bookings" aria-labelledby="scheduler-bookings-title" tabIndex={-1}>
          <PanelTitleRow
            actions={
              <Badge label={`${showingCount} visible of ${review.filteredBookingCount} matching bookings`}>
                {showingCount}/{review.filteredBookingCount}
              </Badge>
            }
            description={`Newest accepted bookings first. Results are capped at ${review.bookingLimit}.`}
            title="Accepted Bookings"
            titleId="scheduler-bookings-title"
          />
          <TableScroll aria-label="All accepted scheduler bookings">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Meeting time</th>
                  <th>Submitter</th>
                  <th>Source link</th>
                  <th>Activity state</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {review.bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td data-label="Requested">{formatDateTime(booking.requestedAt)}</td>
                    <td data-label="Meeting time">
                      <span className="table-primary-cell">
                        <strong>{formatDateTime(booking.startAt, booking.timezone)}</strong>
                        <span className="table-secondary-text">{booking.timezone}</span>
                      </span>
                    </td>
                    <td data-label="Submitter">
                      <SubmissionFieldList
                        company={booking.attendeeCompany}
                        email={booking.attendeeEmail}
                        name={booking.attendeeName}
                        note={booking.attendeeNote}
                      />
                    </td>
                    <td data-label="Source link">
                      <span className="table-primary-cell">
                        {booking.schedulerLink.deletedAt ? (
                          <strong>{booking.schedulerLink.name}</strong>
                        ) : (
                          <Link href={`/scheduler/${booking.schedulerLink.id}` as Route}>{booking.schedulerLink.name}</Link>
                        )}
                        <span className="table-secondary-text">{schedulerLinkStateLabel(booking.schedulerLink)}</span>
                      </span>
                    </td>
                    <td data-label="Activity state">
                      <ActivityState activity={booking.activity} />
                    </td>
                    <td className="table-actions-cell" data-label="Actions">
                      <Link className="button-secondary button-compact" href={bookingDetailHref(booking.id, review.filters)}>
                        Review
                      </Link>
                      {booking.activity && !booking.activity.deletedAt ? (
                        <Link className="button-secondary button-compact" href={`/activities/${booking.activity.id}/edit` as Route}>
                          Activity
                        </Link>
                      ) : null}
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
            review.hasActiveFilters && review.acceptedBookingCount > 0
              ? "Adjust or clear the active filters to review more accepted bookings."
              : "Accepted booking requests will appear here after visitors submit public scheduling links."
          }
          title={
            review.hasActiveFilters && review.acceptedBookingCount > 0
              ? "No bookings match these filters"
              : "No accepted bookings yet"
          }
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function bookingDetailHref(bookingId: string, filters: SchedulerBookingFilters) {
  const returnTo = buildBookingsReturnHref(filters);
  return `/scheduler/bookings/${bookingId}?returnTo=${encodeURIComponent(returnTo)}` as Route;
}

function buildBookingsReturnHref(filters: SchedulerBookingFilters) {
  const params = new URLSearchParams();
  if (filters.schedulerLinkId) params.set("link", filters.schedulerLinkId);
  if (filters.query) params.set("q", filters.query);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.activity) params.set("activity", filters.activity);
  const suffix = params.toString();
  return `/scheduler/bookings${suffix ? `?${suffix}` : ""}#scheduler-bookings`;
}

function activeFilterEntries(
  filters: SchedulerBookingFilters,
  schedulerLinks: Array<{ id: string; name: string }>
) {
  return [
    filters.query ? { label: "Search", value: filters.query } : null,
    filters.schedulerLinkId
      ? { label: "Source link", value: schedulerLinks.find((schedulerLink) => schedulerLink.id === filters.schedulerLinkId)?.name ?? filters.schedulerLinkId }
      : null,
    filters.from ? { label: "From", value: filters.from } : null,
    filters.to ? { label: "To", value: filters.to } : null,
    filters.activity ? { label: "Activity state", value: activityStateFilterLabel(filters.activity) } : null
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));
}

function activityStateFilterLabel(value: string) {
  return ACTIVITY_STATE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function ActivityState({
  activity
}: {
  activity: {
    completedAt: Date | null;
    deletedAt: Date | null;
    id: string;
    title: string;
  } | null;
}) {
  if (!activity || activity.deletedAt) return "Activity unavailable";
  if (activity.completedAt) return "Activity completed";
  return "Activity available";
}

function schedulerLinkStateLabel(schedulerLink: { deletedAt: Date | null; isEnabled: boolean }) {
  if (schedulerLink.deletedAt) return "Source link deleted";
  return schedulerLink.isEnabled ? "Source link enabled" : "Source link disabled";
}

function SubmissionFieldList({
  company,
  email,
  name,
  note
}: {
  company: string | null;
  email: string;
  name: string;
  note: string | null;
}) {
  return (
    <dl className="web-form-submission-fields">
      <div>
        <dt>Name</dt>
        <dd>{name}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>{email}</dd>
      </div>
      {company ? (
        <div>
          <dt>Company</dt>
          <dd>{company}</dd>
        </div>
      ) : null}
      {note ? (
        <div>
          <dt>Note</dt>
          <dd>{note}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function formatDateTime(value: Date | string, timezone?: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: timezone ? "short" : undefined
  }).format(new Date(value));
}
