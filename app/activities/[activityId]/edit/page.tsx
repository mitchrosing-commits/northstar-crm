import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityDueBadge } from "@/components/activity-due-badge";
import { ActivityEditForm } from "@/components/activity-edit-form";
import { AppShell } from "@/components/app-shell";
import { FormHeaderActions } from "@/components/form-header-actions";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { formatActivityType, formatDate } from "@/components/format";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { MeetingPrepBriefCard } from "@/components/meeting-prep-brief-card";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { RecordLockedNotice } from "@/components/record-locked-notice";
import { RecordSummary, type RecordSummaryTone } from "@/components/record-summary";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { activityRecordContext, getActivityDueBucket } from "@/lib/activity-workflow";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { parseReturnToHref, returnToLabel } from "@/lib/return-to";
import { buildMeetingPrepBrief, getActivity, getWorkspace } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ activityId: string }>;
  searchParams?: Promise<{ returnTo?: string }>;
};

export default async function ActivityEditPage({ params, searchParams }: PageProps) {
  const { activityId } = await params;
  const resolvedSearchParams = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [activity, workspaceDetail, meetingPrepBrief] = await Promise.all([
    getActivity(actor, activityId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    getWorkspace(actor),
    buildMeetingPrepBrief(actor, activityId)
  ]);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const defaultReturnPath = getActivityReturnPath(activity);
  const redirectTo = parseReturnToHref(resolvedSearchParams?.returnTo, defaultReturnPath);
  const returnLabel = redirectTo === defaultReturnPath ? getActivityReturnLabel(activity) : returnToLabel(redirectTo);
  const related = activityRecordContext(activity);
  const activityCompleted = Boolean(activity.completedAt);
  const schedulerBooking = activity.schedulerBookings[0] ?? null;
  const pageTitle = activityCompleted ? "Activity details" : "Edit activity";
  const pageSubtitle = activityCompleted
    ? "Completed follow-ups are locked; review the context or create the next follow-up."
    : "Adjust the owner, due date, type, and details for this open follow-up.";
  const completedActivityActions = [
    ...(related
      ? [
          {
            href: buildActivityFollowUpHref({
              related: { type: related.type, id: related.id },
              returnTo: redirectTo,
              title: `Follow up: ${related.label}`
            }),
            label: "Create next follow-up",
            variant: "primary" as const
          }
        ]
      : []),
    { href: redirectTo, label: returnLabel }
  ];
  const linkedRecordActionLabel = related ? activityLinkedRecordActionLabel(related.type, related.label) : "";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <FormHeaderActions
            backHref={redirectTo}
            backLabel={returnLabel}
          />
        }
        eyebrow="Activity"
        subtitle={pageSubtitle}
        title={pageTitle}
      />

      <RecordSummary
        description="Manual follow-up. Due dates organize the work queue; they do not send reminders."
        eyebrow="Follow-up context"
        items={[
          {
            label: "Status",
            value: activity.completedAt ? "Completed and locked" : "Open",
            tone: activity.completedAt ? "muted" : "default"
          },
          {
            label: "Timing",
            value: <ActivityDueBadge activity={activity} />,
            tone: getActivityTimingTone(activity)
          },
          { label: "Type", value: formatActivityType(activity.type) },
          {
            label: "Owner",
            value: activity.owner?.name ?? activity.owner?.email ?? "Unassigned",
            tone: activity.owner ? "default" : "muted"
          },
          {
            label: "Linked record",
            value: related ? (
              <Link
                aria-label={linkedRecordActionLabel}
                className="inline-link"
                href={related.href as Route}
                title={linkedRecordActionLabel}
              >
                {related.label}
              </Link>
            ) : (
              <InlineEmptyStateText>No linked CRM record</InlineEmptyStateText>
            ),
            tone: related ? "default" : "warning"
          },
          ...(schedulerBooking
            ? [
                {
                  label: "Scheduler booking",
                  value: (
                    <Link className="inline-link" href={`/scheduler/bookings/${schedulerBooking.id}` as Route}>
                      {schedulerBooking.schedulerLink.name}
                    </Link>
                  )
                }
              ]
            : [])
        ]}
        title="Activity workspace"
      />

      {meetingPrepBrief ? <MeetingPrepBriefCard brief={meetingPrepBrief} /> : null}

      <section className="data-card">
        <PanelTitleRow title={activity.title} />
        {related ? (
          <FormIntroCallout title="Linked record">
            Linked to{" "}
            <Link
              aria-label={linkedRecordActionLabel}
              className="inline-link"
              href={related.href as Route}
              title={linkedRecordActionLabel}
            >
              {related.label}
            </Link>
            . Rescheduling preserves this record attachment.
          </FormIntroCallout>
        ) : null}
        {activity.completedAt ? (
          <RecordLockedNotice actions={completedActivityActions} title="Completed activities are locked">
            This activity was completed on {formatDate(activity.completedAt)} and cannot be edited or reopened through the normal edit form. Create a new follow-up activity if more work is needed.
          </RecordLockedNotice>
        ) : (
          <ActivityEditForm
            activity={activity}
            cancelLabel={returnLabel}
            owners={owners}
            redirectTo={redirectTo}
            workspaceId={workspace.id}
          />
        )}
      </section>
    </AppShell>
  );
}

function getActivityReturnPath(activity: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}): Route {
  if (activity.dealId) return `/deals/${activity.dealId}` as Route;
  if (activity.leadId) return `/leads/${activity.leadId}` as Route;
  if (activity.personId) return `/contacts/${activity.personId}` as Route;
  if (activity.organizationId) return `/organizations/${activity.organizationId}` as Route;
  return "/activities";
}

function getActivityReturnLabel(activity: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  organizationId: string | null;
}) {
  if (activity.dealId) return "Back to deal";
  if (activity.leadId) return "Back to lead";
  if (activity.personId) return "Back to contact";
  if (activity.organizationId) return "Back to organization";
  return "Back to activities";
}

function activityLinkedRecordActionLabel(type: "deal" | "lead" | "person" | "organization", label: string) {
  if (type === "deal") return `Open linked deal: ${label}`;
  if (type === "lead") return `Open linked lead: ${label}`;
  if (type === "person") return `Open linked contact: ${label}`;
  return `Open linked account: ${label}`;
}

function getActivityTimingTone(activity: { dueAt?: Date | string | null; completedAt?: Date | string | null }): RecordSummaryTone {
  const bucket = getActivityDueBucket(activity);
  if (bucket === "completed") return "muted";
  if (bucket === "overdue") return "danger";
  if (bucket === "today" || bucket === "unscheduled") return "warning";
  return "default";
}
