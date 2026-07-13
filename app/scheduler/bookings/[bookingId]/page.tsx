import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getSchedulerBookingDetail } from "@/lib/services/crm";
import { CopyAttendeeEmailControl } from "./copy-attendee-email-control";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ bookingId: string }>;
  searchParams?: Promise<{
    activity?: string | string[];
    from?: string | string[];
    link?: string | string[];
    q?: string | string[];
    returnTo?: string | string[];
    source?: string | string[];
    to?: string | string[];
  }>;
};

const RETURN_FOCUS_TARGET = "scheduler-bookings";
const VALID_ACTIVITY_FILTERS = new Set(["completed", "open", "unavailable"]);

export default async function SchedulerBookingDetailPage({ params, searchParams }: PageProps) {
  const { bookingId } = await params;
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const booking = await getSchedulerBookingDetail(actor, bookingId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const backHref = buildBackHref(booking.schedulerLink.id, query);
  const activity = booking.activity && !booking.activity.deletedAt ? booking.activity : null;
  const durationMinutes = Math.max(0, Math.round((booking.endAt.getTime() - booking.startAt.getTime()) / 60000));

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <div className="filter-actions">
            <Link className="button-secondary" href={backHref}>
              Back to Review
            </Link>
            {activity ? (
              <Link className="button-primary" href={`/activities/${activity.id}/edit` as Route}>
                Open Activity
              </Link>
            ) : null}
          </div>
        }
        eyebrow="Accepted Scheduler booking"
        subtitle="Review the submitted attendee values, Scheduler configuration, and created CRM activity for this accepted booking."
        title={booking.schedulerLink.meetingTitle}
      />

      <section className="panel section-separated">
        <PanelTitleRow actions={<Badge label="Booking state: Accepted">Accepted</Badge>} title="Submitted Attendee Values" />
        <dl className="scheduler-booking-detail-grid" aria-label="Submitted Scheduler booking values">
          <DetailItem label="Name" value={booking.attendeeName} />
          <div>
            <dt>Email</dt>
            <dd>
              <span className="web-form-submitted-copy-value">
                <span>{booking.attendeeEmail}</span>
                <CopyAttendeeEmailControl value={booking.attendeeEmail} />
              </span>
            </dd>
          </div>
          <DetailItem label="Company" value={booking.attendeeCompany} />
          <DetailItem label="Requested at" value={formatDateTime(booking.requestedAt)} />
          <div className="scheduler-detail-wide">
            <dt>Note</dt>
            <dd>
              {booking.attendeeNote ? (
                <p className="scheduler-booking-message">{booking.attendeeNote}</p>
              ) : (
                "Unavailable in this historical booking."
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          description="Scheduler configuration reflects Northstar-configured availability. Provider-calendar availability is not checked or inferred."
          title="Scheduler Configuration"
        />
        <dl className="scheduler-booking-detail-grid" aria-label="Scheduler source configuration">
          <DetailItem label="Meeting title" value={booking.schedulerLink.meetingTitle} />
          <DetailItem label="Scheduled time" value={formatDateTime(booking.startAt, booking.timezone)} />
          <DetailItem label="Duration" value={`${durationMinutes} minutes`} />
          <DetailItem label="Timezone" value={booking.timezone} />
          <DetailItem label="Minimum notice" value={`${booking.schedulerLink.minimumNoticeMinutes} minutes`} />
          <div>
            <dt>Source link</dt>
            <dd>
              {booking.schedulerLink.deletedAt ? (
                booking.schedulerLink.name
              ) : (
                <Link href={`/scheduler/${booking.schedulerLink.id}` as Route}>{booking.schedulerLink.name}</Link>
              )}
            </dd>
          </div>
          <DetailItem label="Source state" value={schedulerLinkStateLabel(booking.schedulerLink)} />
        </dl>
      </section>

      <section className="panel">
        <PanelTitleRow description="The public booking creates a MEETING activity only. This page does not edit bookings or run automations." title="Linked CRM Activity" />
        <dl className="scheduler-booking-detail-grid" aria-label="Linked Scheduler CRM activity">
          <div>
            <dt>Created MEETING activity</dt>
            <dd>
              {activity ? (
                <Link href={`/activities/${activity.id}/edit` as Route}>{activity.title}</Link>
              ) : (
                "Activity unavailable or deleted."
              )}
            </dd>
          </div>
          <DetailItem label="Activity status" value={activityStateLabel(booking.activity)} />
          <DetailItem label="Booking created" value={formatDateTime(booking.requestedAt)} />
        </dl>
      </section>
    </AppShell>
  );
}

function DetailItem({ label, value }: { label: string; value: Date | string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ? String(value) : "Unavailable in this historical booking."}</dd>
    </div>
  );
}

function buildBackHref(
  schedulerLinkId: string,
  query:
    | {
        activity?: string | string[];
        from?: string | string[];
        link?: string | string[];
        q?: string | string[];
        returnTo?: string | string[];
        source?: string | string[];
        to?: string | string[];
      }
    | undefined
) {
  const returnTo = safeReturnTo(firstQueryValue(query?.returnTo), schedulerLinkId);
  if (returnTo) return returnTo as Route;

  const source = firstQueryValue(query?.source);
  if (source === "link") return withRecentBookingsFocus(`/scheduler/${schedulerLinkId}`) as Route;

  const params = normalizedReturnParams(query);
  const suffix = params.toString();
  return withReturnFocus(`/scheduler/bookings${suffix ? `?${suffix}` : ""}`) as Route;
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeReturnTo(value: string | undefined, schedulerLinkId: string) {
  if (!value || value.startsWith("//")) return null;

  try {
    const url = new URL(value, "https://northstar.local");
    if (url.origin !== "https://northstar.local") return null;

    if (url.pathname === "/scheduler/bookings") {
      const params = normalizedReturnParams(Object.fromEntries(url.searchParams));
      const suffix = params.toString();
      return withReturnFocus(`/scheduler/bookings${suffix ? `?${suffix}` : ""}`);
    }

    if (url.pathname === `/scheduler/${schedulerLinkId}`) {
      return withRecentBookingsFocus(`/scheduler/${schedulerLinkId}`);
    }
  } catch {
    return null;
  }

  return null;
}

function normalizedReturnParams(
  query:
    | {
        activity?: string | string[];
        from?: string | string[];
        link?: string | string[];
        q?: string | string[];
        to?: string | string[];
      }
    | Record<string, string>
    | undefined
) {
  const params = new URLSearchParams();
  const q = normalizeReturnQuery(firstQueryValue(query?.q));
  const link = normalizeReturnId(firstQueryValue(query?.link));
  const from = normalizeReturnDate(firstQueryValue(query?.from));
  const to = normalizeReturnDate(firstQueryValue(query?.to));
  const activity = normalizeReturnActivity(firstQueryValue(query?.activity));

  if (link) params.set("link", link);
  if (q) params.set("q", q);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (activity) params.set("activity", activity);
  return params;
}

function normalizeReturnQuery(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return normalized || null;
}

function normalizeReturnDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeReturnActivity(value: string | undefined) {
  return value && VALID_ACTIVITY_FILTERS.has(value) ? value : null;
}

function normalizeReturnId(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function withReturnFocus(path: string) {
  return `${path}#${RETURN_FOCUS_TARGET}`;
}

function withRecentBookingsFocus(path: string) {
  return `${path}#recent-bookings`;
}

function schedulerLinkStateLabel(schedulerLink: { deletedAt: Date | null; isEnabled: boolean }) {
  if (schedulerLink.deletedAt) return "Source link deleted";
  return schedulerLink.isEnabled ? "Source link enabled" : "Source link disabled";
}

function activityStateLabel(activity: { completedAt: Date | null; deletedAt: Date | null } | null) {
  if (!activity || activity.deletedAt) return "Activity unavailable";
  if (activity.completedAt) return "Activity completed";
  return "Activity available";
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
