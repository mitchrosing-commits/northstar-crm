import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import { formatDate } from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { SchedulerPublicLinkControls } from "@/components/scheduler-public-link-controls";
import { TableScroll } from "@/components/table-scroll";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildPublicSchedulerUrl } from "@/lib/public-url";
import { getSchedulerLinkReview } from "@/lib/services/crm";
import { updateSchedulerLinkAction } from "../actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ schedulerLinkId: string }>;
  searchParams?: Promise<{ updated?: string }>;
};

const weekdays = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" }
] as const;

export default async function SchedulerLinkReviewPage({ params, searchParams }: PageProps) {
  const { schedulerLinkId } = await params;
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const schedulerLink = await getSchedulerLinkReview(actor, schedulerLinkId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const publicUrl = buildPublicSchedulerUrl(schedulerLink.token);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <div className="filter-actions">
            <Link className="button-secondary" href="/scheduler">
              Back to Scheduler
            </Link>
            <Link className="button-primary" href={`/scheduler/bookings?link=${schedulerLink.id}` as Route}>
              Review bookings
            </Link>
          </div>
        }
        eyebrow="Scheduling link review"
        subtitle="Review booking activity and keep this public scheduling link aligned with Northstar-configured availability."
        title={schedulerLink.name}
      />

      {query?.updated === "1" ? <FormSuccessMessage className="section-separated">Scheduling link updated.</FormSuccessMessage> : null}

      <section className="panel section-separated">
        <PanelTitleRow
          actions={<Badge label={`Scheduling link status: ${schedulerLink.isEnabled ? "Enabled" : "Disabled"}`}>{schedulerLink.isEnabled ? "Enabled" : "Disabled"}</Badge>}
          description="Public visitors see only the meeting copy, duration, timezone, and available choices."
          title="Link Summary"
        />
        <dl className="scheduler-review-summary">
          <div>
            <dt>Accepted bookings</dt>
            <dd>{schedulerLink._count.bookings}</dd>
          </div>
          <div>
            <dt>Recent activity</dt>
            <dd>{schedulerLink.latestBookingAt ? formatDate(schedulerLink.latestBookingAt) : "No bookings"}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{schedulerLink.durationMinutes} min</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{schedulerLink.timezone}</dd>
          </div>
        </dl>
        <div className="section-spaced">
          <SchedulerPublicLinkControls isEnabled={schedulerLink.isEnabled} publicUrl={publicUrl} schedulerName={schedulerLink.name} />
        </div>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          description="Renaming or changing availability affects future public choices only. Existing booking activities are retained."
          title="Scheduling Link Settings"
        />
        <form action={updateSchedulerLinkAction} className="scheduler-builder-grid">
          <input name="schedulerLinkId" type="hidden" value={schedulerLink.id} />
          <label className="form-field">
            <FormFieldLabel required>Internal name</FormFieldLabel>
            <input defaultValue={schedulerLink.name} maxLength={120} name="name" required />
          </label>
          <label className="form-field">
            <FormFieldLabel required>Meeting title</FormFieldLabel>
            <input defaultValue={schedulerLink.meetingTitle} maxLength={160} name="meetingTitle" required />
          </label>
          <label className="form-field">
            <FormFieldLabel required>Duration</FormFieldLabel>
            <select defaultValue={String(schedulerLink.durationMinutes)} name="durationMinutes" required>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">60 minutes</option>
              <option value="90">90 minutes</option>
              <option value="120">120 minutes</option>
            </select>
          </label>
          <label className="form-field">
            <FormFieldLabel required>Timezone</FormFieldLabel>
            <input defaultValue={schedulerLink.timezone} maxLength={80} name="timezone" required />
          </label>
          <label className="form-field">
            <FormFieldLabel>Minimum notice</FormFieldLabel>
            <select defaultValue={String(schedulerLink.minimumNoticeMinutes)} name="minimumNoticeMinutes">
              <option value="0">None</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="1440">1 day</option>
              <option value="2880">2 days</option>
            </select>
          </label>
          <label className="checkbox-field scheduler-checkbox-field">
            <input defaultChecked={schedulerLink.isEnabled} name="isEnabled" type="checkbox" />
            <span>Enabled for public booking</span>
          </label>
          <label className="form-field scheduler-field-wide">
            <FormFieldLabel>Description</FormFieldLabel>
            <textarea defaultValue={schedulerLink.description ?? ""} maxLength={800} name="description" rows={3} />
          </label>
          <fieldset className="scheduler-availability-fieldset scheduler-field-wide">
            <legend>Weekly availability</legend>
            <div className="scheduler-availability-grid">
              {weekdays.map((day) => {
                const window = schedulerLink.availability.find((candidate) => candidate.weekday === day.value);
                return (
                  <div className="scheduler-availability-row" key={day.value}>
                    <label className="checkbox-field">
                      <input defaultChecked={Boolean(window)} name={`availability-${day.value}-enabled`} type="checkbox" />
                      <span>{day.label}</span>
                    </label>
                    <label className="form-field">
                      <span className="form-field-label">
                        <span>{day.label} start</span>
                      </span>
                      <input defaultValue={window?.start ?? "09:00"} name={`availability-${day.value}-start`} type="time" />
                    </label>
                    <label className="form-field">
                      <span className="form-field-label">
                        <span>{day.label} end</span>
                      </span>
                      <input defaultValue={window?.end ?? "17:00"} name={`availability-${day.value}-end`} type="time" />
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="form-actions scheduler-field-wide">
            <button className="button-primary" type="submit">
              Save scheduling link
            </button>
          </div>
        </form>
      </section>

      <section className="panel" id="recent-bookings">
        <PanelTitleRow
          actions={<Badge label={`${schedulerLink._count.bookings} accepted bookings`}>{schedulerLink._count.bookings}</Badge>}
          description="Exact duplicate and honeypot attempts are suppressed and are not shown unless they produced an accepted booking."
          title="Recent Booking Requests"
        />
        {schedulerLink.bookings.length > 0 ? (
          <TableScroll aria-label="Recent scheduler booking requests table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Meeting time</th>
                  <th>Submitter fields</th>
                  <th>Source link</th>
                  <th>Linked activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedulerLink.bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td data-label="Requested">{formatDate(booking.requestedAt)}</td>
                    <td data-label="Meeting time">
                      <span className="table-primary-cell">
                        <strong>{formatDateTime(booking.startAt, booking.timezone)}</strong>
                        <span className="table-secondary-text">{booking.timezone}</span>
                      </span>
                    </td>
                    <td data-label="Submitter fields">
                      <span className="table-primary-cell">
                        <strong>{booking.attendeeName}</strong>
                        <span className="table-secondary-text">{booking.attendeeEmail}</span>
                        {booking.attendeeCompany ? <span className="table-secondary-text">{booking.attendeeCompany}</span> : null}
                        {booking.attendeeNote ? <span className="scheduler-booking-note">{booking.attendeeNote}</span> : null}
                      </span>
                    </td>
                    <td data-label="Source link">
                      <Link className="inline-link" href={`/scheduler/${booking.schedulerLink.id}` as Route}>
                        {booking.schedulerLink.name}
                      </Link>
                    </td>
                    <td data-label="Linked activity">
                      {booking.activity && !booking.activity.deletedAt ? (
                        <Link className="inline-link" href={`/activities/${booking.activity.id}/edit` as Route}>
                          {booking.activity.title}
                        </Link>
                      ) : (
                        "Activity unavailable"
                      )}
                    </td>
                    <td className="table-actions-cell" data-label="Actions">
                      <Link className="button-secondary button-compact" href={bookingDetailHref(booking.id, schedulerLink.id)}>
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            description="Share the public link when you are ready. Accepted booking requests will appear here."
            title="No booking requests yet"
            titleLevel="h3"
          />
        )}
      </section>
    </AppShell>
  );
}

function bookingDetailHref(bookingId: string, schedulerLinkId: string) {
  const returnTo = `/scheduler/${schedulerLinkId}#recent-bookings`;
  return `/scheduler/bookings/${bookingId}?returnTo=${encodeURIComponent(returnTo)}` as Route;
}

function formatDateTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(value);
}
