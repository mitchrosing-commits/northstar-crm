import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityEditForm } from "@/components/activity-edit-form";
import { AppShell } from "@/components/app-shell";
import { formatDate } from "@/components/format";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getActivity, getWorkspace } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ activityId: string }>;
};

export default async function ActivityEditPage({ params }: PageProps) {
  const { activityId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [activity, workspaceDetail] = await Promise.all([
    getActivity(actor, activityId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    getWorkspace(actor)
  ]);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const redirectTo = getActivityReturnPath(activity);

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Activity</p>
          <h1 className="page-title">Edit Activity</h1>
        </div>
        <Link className="button-secondary" href={redirectTo}>
          Back
        </Link>
      </header>

      <section className="data-card">
        <h2 className="panel-title">{activity.title}</h2>
        {activity.completedAt ? (
          <div className="empty-state">
            <h3>Completed activities are locked</h3>
            <p>
              This activity was completed on {formatDate(activity.completedAt)} and cannot be edited or reopened
              through the normal edit form. Create a new follow-up activity if more work is needed.
            </p>
            <Link className="button-primary" href={redirectTo}>
              Return to activity
            </Link>
          </div>
        ) : (
          <ActivityEditForm activity={activity} owners={owners} redirectTo={redirectTo} workspaceId={workspace.id} />
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
