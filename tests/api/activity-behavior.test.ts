import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatActivityType } from "@/components/format";
import { classifyActivityDue } from "@/lib/activity-due";
import { activityQuickLinkHref, buildActivityQuickLinks } from "@/lib/activity-quick-links";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const service = [
  readFileSync(join(process.cwd(), "lib/services/activity-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/pipeline-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");
const detailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const contactDetailPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationDetailPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const leadDetailPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const activitiesPage = readFileSync(join(process.cwd(), "app/activities/page.tsx"), "utf8");
const newActivityPage = readFileSync(join(process.cwd(), "app/activities/new/page.tsx"), "utf8");
const activityEditPage = readFileSync(join(process.cwd(), "app/activities/[activityId]/edit/page.tsx"), "utf8");
const activityForm = readFileSync(join(process.cwd(), "components/activity-form.tsx"), "utf8");
const activityEditForm = readFileSync(join(process.cwd(), "components/activity-edit-form.tsx"), "utf8");
const activityList = readFileSync(join(process.cwd(), "components/activity-list.tsx"), "utf8");
const completeButton = readFileSync(join(process.cwd(), "components/activity-complete-button.tsx"), "utf8");
const deleteButton = readFileSync(join(process.cwd(), "components/activity-delete-button.tsx"), "utf8");
const recordActivitiesPanel = readFileSync(join(process.cwd(), "components/record-activities-panel.tsx"), "utf8");
const dealsPage = readFileSync(join(process.cwd(), "app/deals/page.tsx"), "utf8");
const dueBadge = readFileSync(join(process.cwd(), "components/activity-due-badge.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("activity create and completion behavior", () => {
  it("classifies activity due dates for daily follow-up work", () => {
    const now = new Date("2030-03-04T12:00:00.000Z");

    expect(classifyActivityDue({ dueAt: "2030-03-03T09:00:00.000Z", completedAt: null }, now)).toBe("overdue");
    expect(classifyActivityDue({ dueAt: "2030-03-04T09:00:00.000Z", completedAt: null }, now)).toBe("today");
    expect(classifyActivityDue({ dueAt: "2030-03-05T09:00:00.000Z", completedAt: null }, now)).toBe("upcoming");
    expect(classifyActivityDue({ dueAt: null, completedAt: null }, now)).toBe("unscheduled");
    expect(classifyActivityDue({ dueAt: "not-a-date", completedAt: null }, now)).toBe("unscheduled");
    expect(classifyActivityDue({ dueAt: "2030-03-05T09:00:00.000Z", completedAt: null }, new Date("nope"))).toBe("unscheduled");
    expect(classifyActivityDue({ dueAt: "2030-03-03T09:00:00.000Z", completedAt: "2030-03-04T10:00:00.000Z" }, now)).toBe("completed");
  });

  it("formats activity type labels for detail and timeline readability", () => {
    expect(formatActivityType("CALL")).toBe("Call");
    expect(formatActivityType("EMAIL")).toBe("Email");
    expect(formatActivityType("MEETING")).toBe("Meeting");
    expect(formatActivityType("TASK")).toBe("Task");
    expect(formatActivityType("CUSTOM")).toBe("CUSTOM");
  });

  it("routes activity create and update through validated API payloads", () => {
    expect(route).toContain("createActivitySchema.parse");
    expect(route).toContain("updateActivitySchema.parse");
    expect(route).toContain("createActivity(actor");
    expect(route).toContain("updateActivity(actor");
    expect(route).toContain("softDeleteActivity(actor");
  });

  it("supports editing open activities without changing their attachments", () => {
    expect(service).toContain("export async function getActivity");
    expect(service).toContain("where: { id: activityId, workspaceId: actor.workspaceId");
    expect(service).toContain("assertActivityAttachmentNotChanged");
    expect(service).toContain("ACTIVITY_ATTACHMENT_LOCKED");
    expect(activityList).toContain("href={`/activities/${activity.id}/edit`}");
    expect(activityEditPage).toContain("getActivity(actor, activityId)");
    expect(activityEditPage).toContain("ActivityEditForm");
    expect(activityEditPage).toContain("getActivityReturnPath");
    expect(activityEditForm).toContain("method: \"PATCH\"");
    expect(activityEditForm).toContain("title: title.trim()");
    expect(activityEditForm).toContain("description: description.trim() || null");
    expect(activityEditForm).toContain("Manual follow-up only. Due dates help sort work; they do not send reminders.");
    expect(activityEditForm).toContain("Used for work-queue order, not calendar reminders.");
    expect(activityEditForm).not.toContain("...attachment");
  });

  it("locks completed activities from normal edits", () => {
    expect(service).toContain("if (existing.completedAt)");
    expect(service).toContain("ACTIVITY_COMPLETED");
    expect(activityEditPage).toContain("Completed activities are locked");
    expect(activityEditPage).toContain("cannot be edited or reopened");
    expect(activityEditPage).toContain("through the normal edit form");
    expect(activityEditPage).toContain("Create a new follow-up activity if more work is needed.");
  });

  it("keeps activity mutations workspace-scoped and audited", () => {
    expect(service).toContain("assertRecordInWorkspace(\"activity\"");
    expect(service).toContain("assertActivityLinks");
    expect(service).toContain("assertRecordInWorkspace(\"deal\"");
    expect(service).toContain("assertRecordInWorkspace(\"person\"");
    expect(service).toContain("assertRecordInWorkspace(\"organization\"");
    expect(service).toContain("lead.status === \"CONVERTED\"");
    expect(service).toContain("writeAuditLog(actor, \"activity.created\"");
    expect(service).toContain("activity.updated");
    expect(service).toContain("activity.completed");
    expect(service).toContain("activity.deleted");
    expect(service).toContain("completedNow");
  });

  it("lets the deal detail page add and complete deal activities", () => {
    expect(detailPage).toContain("RecordActivitiesPanel");
    expect(detailPage).toContain("Add next activity");
    expect(detailPage).toContain("formId=\"add-activity\"");
    expect(detailPage).toContain("Open Next Steps");
    expect(detailPage).toContain("Completed Activity History");
    expect(detailPage).toContain("showCompleteAction");
    expect(recordActivitiesPanel).toContain("ActivityForm");
    expect(recordActivitiesPanel).toContain("ActivityList");
  });

  it("submits new activities and completion through the workspace activity API", () => {
    expect(activityForm).toContain("/api/v1/workspaces/${workspaceId}/activities");
    expect(activityForm).toContain("ActivityAttachment");
    expect(activityForm).toContain("attachmentOptions");
    expect(activityForm).toContain("parseAttachmentValue");
    expect(activityForm).toContain("leadId");
    expect(activityForm).toContain("personId");
    expect(activityForm).toContain("organizationId");
    expect(activityForm).toContain("description");
    expect(activityForm).toContain("completed ? new Date().toISOString() : null");
    expect(activityForm).toContain("Manual follow-up only. Due dates help sort work; they do not send reminders.");
    expect(activityForm).toContain("Used for work-queue order, not calendar reminders.");
    expect(activityForm).toContain("Attach this follow-up to an existing deal, contact, organization, or lead.");
    expect(activityForm).toContain("Mark complete now");
    expect(completeButton).toContain("/api/v1/workspaces/${workspaceId}/activities/${activityId}");
    expect(completeButton).toContain("completedAt");
  });

  it("adds a global new activity page with selectable CRM associations", () => {
    expect(activitiesPage).toContain("href=\"/activities/new\"");
    expect(activitiesPage).toContain("New activity");
    expect(newActivityPage).toContain("export default async function NewActivityPage");
    expect(newActivityPage).toContain("listDeals(actor, { status: \"OPEN\" })");
    expect(newActivityPage).toContain("listPeople(actor)");
    expect(newActivityPage).toContain("listOrganizations(actor)");
    expect(newActivityPage).toContain("listLeads(actor)");
    expect(newActivityPage).toContain("lead.status !== \"CONVERTED\"");
    expect(newActivityPage).toContain("attachmentOptions={attachmentOptions}");
    expect(newActivityPage).toContain("redirectTo={\"/activities\" as Route}");
  });

  it("shows due buckets and daily work queue counts on activity surfaces", () => {
    expect(service).toContain("export async function getActivityWorkQueueSummary");
    expect(service).toContain("overdue + dueToday + upcoming + unscheduled");
    expect(service).toContain("if (due === \"today\")");
    expect(service).toContain("where.completedAt = null");
    expect(activitiesPage).toContain("getActivityWorkQueueSummary(actor)");
    expect(activitiesPage).toContain("Due today");
    expect(activitiesPage).toContain("Open total");
    expect(activitiesPage).toContain("Open activities");
    expect(activitiesPage).toContain("Completed activities");
    expect(activitiesPage).toContain("Open overdue");
    expect(activitiesPage).toContain("Open due today");
    expect(activitiesPage).toContain("Open upcoming");
    expect(activitiesPage).toContain("Due filters show open activities only.");
    expect(activitiesPage).toContain("Quick activity links");
    expect(activitiesPage).toContain("Due quick links show open activities only.");
    expect(activitiesPage).toContain("buildActivityQuickLinks(actorUserId)");
    expect(activitiesPage).toContain("Any related record");
    expect(activitiesPage).toContain("No activities match these filters. Clear filters to return to the full work queue.");
    expect(activitiesPage).toContain("No activities yet. Create a follow-up to plan the next call, email, meeting, or task.");
    expect(activityList).toContain("ActivityDueBadge");
    expect(activityList).toContain("formatActivityType(activity.type)");
    expect(dueBadge).toContain("activity-due-${bucket}");
    expect(dueBadge).toContain("Due today");
    expect(dueBadge).toContain("Due ${formatDate(activity.dueAt)}");
    expect(globalStyles).toContain("activity-due-overdue");
  });

  it("builds activity quick links from existing URL filters while resetting page number", () => {
    expect(buildActivityQuickLinks("user_123")).toEqual([
      { label: "My open", href: "/activities?status=open&ownerId=user_123" },
      { label: "Overdue", href: "/activities?due=overdue" },
      { label: "Due today", href: "/activities?due=today" },
      { label: "Upcoming", href: "/activities?due=upcoming" },
      { label: "Completed", href: "/activities?status=completed" }
    ]);
    expect(activityQuickLinkHref({ status: "open", ownerId: "user_123" })).not.toContain("page=");
    expect(activityQuickLinkHref({ due: "today" })).toBe("/activities?due=today");
    expect(activityQuickLinkHref({ status: "completed" })).toBe("/activities?status=completed");
    expect(activityQuickLinkHref({ due: "overdue" })).not.toContain("ownerId=");
    expect(activityQuickLinkHref({ due: "upcoming" })).not.toContain("related=");
  });

  it("adds soft-delete actions for open and completed activities wherever activity lists render", () => {
    expect(activityList).toContain("ActivityDeleteButton");
    expect(activityList).toContain("<ActivityDeleteButton activityId={activity.id} workspaceId={workspaceId} />");
    expect(activityList).toContain("{!activity.completedAt ? (");
    expect(deleteButton).toContain("method: \"DELETE\"");
    expect(deleteButton).toContain("/api/v1/workspaces/${workspaceId}/activities/${activityId}");
    expect(deleteButton).toContain("router.refresh()");
  });

  it("lets contact, organization, and lead detail pages create and complete activities", () => {
    expect(contactDetailPage).toContain("RecordActivitiesPanel");
    expect(contactDetailPage).toContain("attachment={{ personId: person.id }}");
    expect(contactDetailPage).toContain("showCompleteAction");
    expect(organizationDetailPage).toContain("RecordActivitiesPanel");
    expect(organizationDetailPage).toContain("attachment={{ organizationId: organization.id }}");
    expect(organizationDetailPage).toContain("showCompleteAction");
    expect(leadDetailPage).toContain("RecordActivitiesPanel");
    expect(leadDetailPage).toContain("attachment={{ leadId: lead.id }}");
    expect(leadDetailPage).toContain("showCompleteAction");
    expect(recordActivitiesPanel).toContain("ActivityForm");
  });

  it("blocks activity creation UI for converted leads and keeps global completion available", () => {
    expect(leadDetailPage).toContain("lead.status === \"CONVERTED\"");
    expect(leadDetailPage).toContain("Create follow-up activities on the converted deal.");
    expect(activitiesPage).toContain("showCompleteAction");
    expect(activitiesPage).toContain("workspaceId={workspace.id}");
  });

  it("keeps pipeline next activity based on incomplete deal activities", () => {
    expect(service).toContain("completedAt: null");
    expect(service).toContain("nulls: \"last\"");
    expect(service).toContain("take: 1");
  });

  it("surfaces next open activity on the Deals list", () => {
    expect(dealsPage).toContain("<th>Next activity</th>");
    expect(dealsPage).toContain("NextActivitySummary");
    expect(dealsPage).toContain("deal.activities[0]");
    expect(dealsPage).toContain("No open activity");
  });
});
