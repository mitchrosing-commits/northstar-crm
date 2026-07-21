import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatActivityDueBadgeLabel } from "@/components/activity-due-badge";
import { formatActivityType } from "@/components/format";
import { classifyActivityDue } from "@/lib/activity-due";
import { activityQuickLinkHref, buildActivityQuickLinks } from "@/lib/activity-quick-links";
import { activityRecordContext, getActivityStatusLabel, getNextActivityForRecord, summarizeActivityTiming } from "@/lib/activity-workflow";
import { parseReturnToHref, returnToLabel } from "@/lib/return-to";

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
const newDealPage = readFileSync(join(process.cwd(), "app/deals/new/page.tsx"), "utf8");
const newContactPage = readFileSync(join(process.cwd(), "app/contacts/new/page.tsx"), "utf8");
const newOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/new/page.tsx"), "utf8");
const newLeadPage = readFileSync(join(process.cwd(), "app/leads/new/page.tsx"), "utf8");
const activityForm = readFileSync(join(process.cwd(), "components/activity-form.tsx"), "utf8");
const activityEditForm = readFileSync(join(process.cwd(), "components/activity-edit-form.tsx"), "utf8");
const dealForm = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");
const contactForm = readFileSync(join(process.cwd(), "components/contact-form.tsx"), "utf8");
const organizationForm = readFileSync(join(process.cwd(), "components/organization-form.tsx"), "utf8");
const leadForm = readFileSync(join(process.cwd(), "components/lead-form.tsx"), "utf8");
const activityFormGuidance = readFileSync(join(process.cwd(), "components/activity-form-guidance.tsx"), "utf8");
const recordActivityCopy = readFileSync(join(process.cwd(), "lib/record-activity-copy.ts"), "utf8");
const returnTo = readFileSync(join(process.cwd(), "lib/return-to.ts"), "utf8");
const activityDueDateShortcuts = readFileSync(join(process.cwd(), "components/activity-due-date-shortcuts.tsx"), "utf8");
const listNextActivitySummary = readFileSync(join(process.cwd(), "components/list-next-activity-summary.tsx"), "utf8");
const activityList = readFileSync(join(process.cwd(), "components/activity-list.tsx"), "utf8");
const activityWorkflow = readFileSync(join(process.cwd(), "lib/activity-workflow.ts"), "utf8");
const personName = readFileSync(join(process.cwd(), "lib/person-name.ts"), "utf8");
const recordOwnerLabel = readFileSync(join(process.cwd(), "lib/record-owner-label.ts"), "utf8");
const statCard = readFileSync(join(process.cwd(), "components/stat-card.tsx"), "utf8");
const completeButton = readFileSync(join(process.cwd(), "components/activity-complete-button.tsx"), "utf8");
const deleteButton = readFileSync(join(process.cwd(), "components/activity-delete-button.tsx"), "utf8");
const recordActivitiesPanel = readFileSync(join(process.cwd(), "components/record-activities-panel.tsx"), "utf8");
const panelTitleRow = readFileSync(join(process.cwd(), "components/panel-title-row.tsx"), "utf8");
const compactTitleRow = readFileSync(join(process.cwd(), "components/compact-title-row.tsx"), "utf8");
const recordPanelJumpNav = readFileSync(join(process.cwd(), "components/record-panel-jump-nav.tsx"), "utf8");
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
    expect(getActivityStatusLabel("unscheduled")).toBe("No due date");
    expect(summarizeActivityTiming({ dueAt: "2030-03-04T09:00:00.000Z", completedAt: null }, now)).toMatchObject({
      bucket: "today",
      isActionable: true,
      label: "Due today"
    });
    expect(
      getNextActivityForRecord(
        [
          { id: "later", title: "Later", dueAt: "2030-03-06T09:00:00.000Z", completedAt: null },
          { id: "overdue", title: "Overdue", dueAt: "2030-03-03T09:00:00.000Z", completedAt: null }
        ],
        now
      )?.id
    ).toBe("overdue");
    expect(
      activityRecordContext({
        person: { id: "person_123", firstName: "", lastName: null }
      })
    ).toMatchObject({ href: "/contacts/person_123", label: "Unnamed contact", type: "person" });
    expect(activityWorkflow).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(activityWorkflow).toContain('label: formatPersonName(activity.person) ?? "Unnamed contact"');
  });

  it("formats activity due badge labels for shared visible state", () => {
    expect(
      formatActivityDueBadgeLabel("completed", {
        completedAt: "2030-03-04T10:00:00.000Z",
        dueAt: "2030-03-03T09:00:00.000Z"
      })
    ).toBe("Completed Mar 4, 2030");
    expect(formatActivityDueBadgeLabel("overdue", { dueAt: "2030-03-03T09:00:00.000Z" })).toBe(
      "Overdue Mar 3, 2030"
    );
    expect(formatActivityDueBadgeLabel("today", { dueAt: "2030-03-04T09:00:00.000Z" })).toBe("Due today");
    expect(formatActivityDueBadgeLabel("upcoming", { dueAt: "2030-03-05T09:00:00.000Z" })).toBe(
      "Due Mar 5, 2030"
    );
    expect(formatActivityDueBadgeLabel("unscheduled", { dueAt: null })).toBe("No due date");
  });

  it("sanitizes activity return paths before preserving source workflow context", () => {
    expect(parseReturnToHref("/search?q=Acme", "/activities")).toBe("/search?q=Acme");
    expect(parseReturnToHref("/deals/deal_123#activities", "/activities")).toBe("/deals/deal_123#activities");
    expect(parseReturnToHref("/settings/ai?saved=1#ai-preferences", "/activities")).toBe("/settings/ai?saved=1#ai-preferences");
    expect(parseReturnToHref("/web-forms/form_123?q=Acme#accepted-submissions", "/activities")).toBe("/web-forms/form_123?q=Acme#accepted-submissions");
    expect(parseReturnToHref("https://example.test/search", "/activities")).toBe("/activities");
    expect(parseReturnToHref("//example.test/search", "/activities")).toBe("/activities");
    expect(returnToLabel("/search?q=Acme")).toBe("Back to search");
    expect(returnToLabel("/deals?status=OPEN")).toBe("Back to deals");
    expect(returnToLabel("/deals/deal_123#activities")).toBe("Back to deal");
    expect(returnToLabel("/activities")).toBe("Back to activities");
    expect(returnToLabel("/email")).toBe("Back to email");
    expect(returnToLabel("/settings/ai?saved=1#ai-preferences")).toBe("Back to settings");
    expect(returnToLabel("/web-forms/form_123?q=Acme#accepted-submissions")).toBe("Back to web forms");
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
    expect(service).toContain("normalizeCreateActivityInput(data)");
    expect(service).toContain("normalizeUpdateActivityInput(data)");
    expect(service).toContain("Activity update must be an object.");
    expect(service).toContain("Activity relation ids must be text.");
    expect(service).toContain("Activity type must be CALL, EMAIL, MEETING, or TASK.");
    expect(service).toContain("assertActivityAttachmentNotChanged");
    expect(service).toContain("ACTIVITY_ATTACHMENT_LOCKED");
    expect(activityList).toContain("href={`/activities/${activity.id}/edit`}");
    expect(activityList).toContain("const activityWorkspaceLabel = activity.completedAt");
    expect(activityList).toContain("`View completed activity ${activity.title}`");
    expect(activityList).toContain("`Edit activity ${activity.title}`");
    expect(activityList).toContain("aria-label={activityWorkspaceLabel}");
    expect(activityList).toContain("title={activityWorkspaceLabel}");
    expect(activityList).toContain("<strong>{activity.title}</strong>");
    expect(activityEditPage).toContain("getActivity(actor, activityId)");
    expect(activityEditPage).toContain("RecordSummary");
    expect(activityEditPage).toContain('const pageTitle = activityCompleted ? "Activity details" : "Edit activity"');
    expect(activityEditPage).toContain("subtitle={pageSubtitle}");
    expect(activityEditPage).toContain("title={pageTitle}");
    expect(activityEditPage).toContain("title=\"Activity workspace\"");
    expect(activityEditPage).toContain("ActivityDueBadge activity={activity}");
    expect(activityEditPage).toContain("getActivityTimingTone(activity)");
    expect(activityEditPage).toContain("Linked record");
    expect(activityEditPage).toContain("const linkedRecordActionLabel = related ? activityLinkedRecordActionLabel(related.type, related.label) : \"\"");
    expect(activityEditPage).toContain("aria-label={linkedRecordActionLabel}");
    expect(activityEditPage).toContain("title={linkedRecordActionLabel}");
    expect(activityEditPage).toContain('import { InlineEmptyStateText } from "@/components/inline-empty-state-text"');
    expect(activityEditPage).toContain("<InlineEmptyStateText>No linked CRM record</InlineEmptyStateText>");
    expect(activityEditPage).not.toContain('"Not linked"');
    expect(activityEditPage).toContain("function activityLinkedRecordActionLabel");
    expect(activityEditPage).toContain("return `Open linked deal: ${label}`");
    expect(activityEditPage).toContain("return `Open linked contact: ${label}`");
    expect(activityEditPage).toContain("return `Open linked account: ${label}`");
    expect(activityEditPage).toContain("PanelTitleRow");
    expect(activityEditPage).toContain("title={activity.title}");
    expect(activityEditPage).not.toContain("<h2 className=\"panel-title\">{activity.title}</h2>");
    expect(activityEditPage).toContain("ActivityEditForm");
    expect(activityEditPage).toContain("getActivityReturnPath");
    expect(activityEditPage).toContain("parseReturnToHref(resolvedSearchParams?.returnTo, defaultReturnPath)");
    expect(activityEditPage).toContain("const returnLabel = redirectTo === defaultReturnPath ? getActivityReturnLabel(activity) : returnToLabel(redirectTo)");
    expect(activityEditForm).toContain("method: \"PATCH\"");
    expect(activityEditForm).toContain("title: title.trim()");
    expect(activityEditForm).toContain("description: description.trim() || null");
    expect(activityEditForm).toContain("ActivityManualFollowUpHint");
    expect(activityEditForm).toContain("ActivityDueDateHint");
    expect(activityFormGuidance).toContain("Manual follow-up only. Due dates help sort work; they do not send reminders.");
    expect(activityFormGuidance).toContain("Used for work-queue order, not calendar reminders.");
    expect(activityEditForm).toContain("ActivityDueDateShortcuts");
    expect(activityEditPage).toContain("Rescheduling preserves this record attachment.");
    expect(activityEditForm).not.toContain("...attachment");
  });

  it("locks completed activities from normal edits", () => {
    expect(service).toContain("if (existing.completedAt)");
    expect(service).toContain("ACTIVITY_COMPLETED");
    expect(service).toContain("Completed activities cannot be removed.");
    expect(activityList).toContain("View");
    expect(activityList).toContain("activity.completedAt && followUpHref");
    expect(activityEditPage).toContain("Completed activities are locked");
    expect(activityEditPage).toContain("Completed follow-ups are locked; review the context or create the next follow-up.");
    expect(activityEditPage).toContain("RecordLockedNotice");
    expect(activityEditPage).toContain("completedActivityActions");
    expect(activityEditPage).toContain("cannot be edited or reopened");
    expect(activityEditPage).toContain("through the normal edit form");
    expect(activityEditPage).toContain("Create a new follow-up activity if more work is needed.");
    expect(activityEditPage).toContain("Create next follow-up");
    expect(activityEditPage).toContain("returnTo: redirectTo");
    expect(activityEditPage).toContain("{ href: redirectTo, label: returnLabel }");
    expect(activityEditPage).not.toContain("<div className=\"empty-state\">");
  });

  it("keeps activity mutations workspace-scoped and audited", () => {
    expect(service).toContain("where: {\n      id: activityId,\n      workspaceId: actor.workspaceId");
    expect(service).toContain("...activityAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("assertActivityLinks");
    expect(service).toContain("requireAttachment: true");
    expect(service).toContain("Attach the activity to a CRM record.");
    expect(service).toContain("assertOpenDealInWorkspace");
    expect(service).toContain("Closed deals cannot be edited.");
    expect(service).toContain("isActivityCompletionOnlyUpdate");
    expect(service).toContain("assertActivityParentUnlocked(existing, { allowClosedDeal: isActivityCompletionOnlyUpdate(normalized) })");
    expect(service).toContain("assertActivityParentUnlocked(existing, { allowClosedDeal: true })");
    expect(service).toContain("actionableActivityRelationsWhere");
    expect(service).toContain("assertRecordInWorkspace(\"person\"");
    expect(service).toContain("assertRecordInWorkspace(\"organization\"");
    expect(service).toContain("lead.status === \"CONVERTED\"");
    expect(service).toContain("Object.keys(normalized).length === 0 || !activityUpdateChanges(normalized, existing)");
    expect(service).toContain("activityUpdateChanges(");
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
    expect(detailPage).toContain('lockedMessage={closedDealLockMessage("activities")}');
    expect(recordActivityCopy).toContain("Open Next Steps");
    expect(recordActivityCopy).toContain("Completed Activity History");
    expect(detailPage).toContain("showCompleteAction: deal.status === \"OPEN\"");
    expect(detailPage).toContain("showForm={deal.status === \"OPEN\"}");
    expect(recordActivitiesPanel).toContain("section-spaced");
    expect(recordActivitiesPanel).toContain("activityManualFollowUpCopy");
    expect(recordActivitiesPanel).toContain("description={activityManualFollowUpCopy}");
    expect(recordActivitiesPanel).toContain("record-activity-section-hint");
    expect(recordActivitiesPanel).toContain("PanelTitleRow");
    expect(recordActivitiesPanel).toContain('import { CountBadge } from "@/components/count-badge"');
    expect(recordActivitiesPanel).toContain("const addActivityLabel = \"Add activity from this record\"");
    expect(recordActivitiesPanel).toContain("const activityCountLabel = `${section.activities.length} ${section.title.toLowerCase()} ${");
    expect(recordActivitiesPanel).toContain("<CountBadge label={activityCountLabel}>");
    expect(recordActivitiesPanel).toContain("actionsLabel={`${section.title} activity count`}");
    expect(recordActivitiesPanel).toContain("EmptyState");
    expect(recordActivitiesPanel).toContain("const addActivityHref = showForm && formId ? `#${formId}` : undefined");
    expect(recordActivitiesPanel).toContain("addActivityHref ? (");
    expect(recordActivitiesPanel).toContain("aria-label={addActivityLabel}");
    expect(recordActivitiesPanel).toContain("href={addActivityHref}");
    expect(recordActivitiesPanel).toContain("title={addActivityLabel}");
    expect(recordActivitiesPanel).toContain("Add activity");
    expect(recordActivitiesPanel).toContain("empty-state-compact empty-state-panel");
    expect(recordActivitiesPanel).toContain("title={section.emptyMessage}");
    expect(panelTitleRow).toContain("description ? <p className=\"form-hint panel-title-description\">{description}</p> : null");
    expect(recordActivitiesPanel).toContain("count-badge");
    expect(recordActivitiesPanel).toContain("id = \"activities\"");
    expect(recordActivitiesPanel).toContain("id={id}");
    expect(recordActivitiesPanel).toContain("ActivityForm");
    expect(recordActivitiesPanel).toContain("ActivityList");
    expect(detailPage).toContain("RecordPanelJumpNav");
    expect(recordPanelJumpNav).toContain("href: \"#activities\" as Route");
    expect(detailPage).toContain('recordActivitySectionCopy("dealOpen")');
    expect(detailPage).toContain('recordActivitySectionCopy("dealCompleted")');
    expect(recordActivityCopy).toContain("Open follow-ups attached to this deal, sorted into the record workspace.");
    expect(recordActivityCopy).toContain("Completed follow-ups stay visible for customer history and handoffs.");
    expect(globalStyles).not.toContain(".record-activity-form-hint");
    expect(globalStyles).toContain(".record-activity-section-hint");
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
    expect(activityForm).toContain("ActivityManualFollowUpHint");
    expect(activityForm).toContain("ActivityDueDateHint");
    expect(activityFormGuidance).toContain("ActivityManualFollowUpHint");
    expect(activityFormGuidance).toContain("ActivityDueDateHint");
    expect(activityForm).toContain("ActivityDueDateShortcuts");
    expect(activityDueDateShortcuts).toContain("export function ActivityDueDateShortcuts");
    expect(activityDueDateShortcuts).toContain('const shortcutGroupLabel = "Due date shortcuts"');
    expect(activityDueDateShortcuts).toContain("import { ActionGroup }");
    expect(activityDueDateShortcuts).toContain('<ActionGroup className="filter-actions due-shortcuts" label={shortcutGroupLabel}>');
    expect(activityDueDateShortcuts).toContain("aria-label={`Set due date to ${shortcut.label.toLowerCase()}`}");
    expect(activityDueDateShortcuts).toContain("title={`Set due date to ${shortcut.label.toLowerCase()}`}");
    expect(activityDueDateShortcuts).toContain("Today");
    expect(activityDueDateShortcuts).toContain("Tomorrow");
    expect(activityDueDateShortcuts).toContain("Next week");
    expect(activityForm).toContain("Attach this follow-up to an existing deal, contact, organization, or lead.");
    expect(activityForm).toContain("Mark complete now");
    expect(activityForm).toContain('router.replace(currentPathWithHash("activities"), { scroll: true })');
    expect(activityForm).toContain('import { FormSuccessMessage } from "@/components/form-success-message"');
    expect(activityForm).toContain("Activity added. Recent activities refreshed.");
    expect(activityForm).toContain("Activity saved as complete. Recent activities refreshed.");
    expect(activityForm).toContain("<FormSuccessMessage compact>{success}</FormSuccessMessage>");
    expect(activityForm).toContain("ActivityRelatedRecordCreateLinks");
    expect(activityForm).toContain("Create and return:");
    expect(activityForm).toContain("buildActivityDraftReturnTo");
    expect(activityForm).toContain('params.set("description", trimmedDescription)');
    expect(activityForm).toContain('params.set("ownerId", ownerId)');
    expect(activityForm).toContain('relatedRecordCreateHref("/contacts/new"');
    expect(activityForm).toContain('relatedRecordCreateHref("/organizations/new"');
    expect(activityForm).toContain('relatedRecordCreateHref("/deals/new"');
    expect(activityForm).toContain('relatedRecordCreateHref("/leads/new"');
    expect(activityForm).toContain("function currentPathWithHash");
    expect(completeButton).toContain("/api/v1/workspaces/${workspaceId}/activities/${activityId}");
    expect(completeButton).toContain("completedAt");
    expect(completeButton).toContain("ariaLabel?: string");
    expect(completeButton).toContain("aria-label={ariaLabel}");
    expect(completeButton).toContain("title={ariaLabel}");
    expect(completeButton).toContain('const actionsLabel = "Complete activity actions"');
    expect(completeButton).toContain("import { ActionGroup }");
    expect(completeButton).toContain('<ActionGroup className="activity-actions" label={actionsLabel}>');
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
    expect(newActivityPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(newActivityPage).toContain('Contact: ${formatPersonName(person) ?? "Unnamed contact"}');
    expect(newActivityPage).not.toContain("function formatPersonName");
    expect(personName).toContain("export function formatPersonName");
    expect(newActivityPage).toContain("attachmentOptions={attachmentOptions}");
    expect(newActivityPage).toContain("attachmentOptions.length > 0 ? (");
    expect(newActivityPage).toContain('import { parseReturnToHref, returnToLabel } from "@/lib/return-to"');
    expect(newActivityPage).toContain('const returnHref = parseReturnToHref(resolvedSearchParams?.returnTo, "/activities")');
    expect(newActivityPage).toContain("const returnLabel = returnToLabel(returnHref)");
    expect(newActivityPage).toContain("redirectTo={returnHref}");
    expect(newActivityPage).toContain("cancelHref={returnHref}");
    expect(newActivityPage).toContain("ownerId?: string");
    expect(newActivityPage).toContain("initialOwnerId={trimParam(resolvedSearchParams?.ownerId)}");
    expect(activityForm).toContain("initialOwnerId?: string");
    expect(activityForm).toContain("const resolvedInitialOwnerId");
    expect(newDealPage).toContain("parseReturnToHref(resolvedSearchParams?.returnTo, \"/deals\")");
    expect(newDealPage).toContain("returnTo={hasReturnTo ? { href: returnHref, paramName: \"dealId\" } : undefined}");
    expect(dealForm).toContain('paramName: "dealId"');
    expect(dealForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, deal.id)");
    expect(newContactPage).toContain("leadOrActivityReturnToParam");
    expect(newContactPage).toContain('String(activityReturnTo).startsWith("/activities/new")');
    expect(contactForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, contact.id)");
    expect(newOrganizationPage).toContain("leadOrActivityReturnToParam");
    expect(newOrganizationPage).toContain('String(activityReturnTo).startsWith("/activities/new")');
    expect(organizationForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, organization.id)");
    expect(newLeadPage).toContain("parseReturnToHref(resolvedSearchParams?.returnTo, \"/leads\")");
    expect(newLeadPage).toContain("returnTo={hasReturnTo ? { href: returnHref, paramName: \"leadId\" } : undefined}");
    expect(leadForm).toContain('paramName: "leadId"');
    expect(leadForm).toContain("appendReturnParam(returnTo.href, returnTo.paramName, lead.id)");
    expect(returnTo).toContain("const allowedReturnPathPrefixes");
    expect(returnTo).toContain("trimmed.startsWith(\"//\")");
    expect(newActivityPage).toContain("PanelTitleRow");
    expect(newActivityPage).toContain("title=\"Create Follow-up\"");
    expect(newActivityPage).not.toContain("<h2 className=\"panel-title\">Create Follow-up</h2>");
    expect(newActivityPage).toContain("FormIntroCallout");
    expect(newActivityPage).toContain("title=\"Prefilled follow-up\"");
    expect(newActivityPage).toContain("EmptyState");
    expect(newActivityPage).toContain("className=\"section-separated\"");
    expect(newActivityPage).toContain("actions={");
    expect(newActivityPage).toContain("Create something to follow up on");
    expect(newActivityPage.indexOf("EmptyState")).toBeLessThan(newActivityPage.indexOf("attachmentOptions.length > 0 ? ("));
    expect(newActivityPage).toContain(") : null}");
    expect(newActivityPage).not.toContain("<div className=\"empty-state section-separated\">");
    expect(newActivityPage).not.toContain("style={{ marginBottom: 12 }}");
    expect(newActivityPage).not.toContain("style={{ marginBottom: 16 }}");
  });

  it("shows due buckets and daily work queue counts on activity surfaces", () => {
    expect(service).toContain("export async function getActivityWorkQueueSummary");
    expect(service).toContain("export async function getFollowUpHealthSummary");
    expect(service).toContain("export async function listRecordsMissingNextActivity");
    expect(service).toContain("overdue + dueToday + upcoming + unscheduled");
    expect(service).toContain("completedRecently");
    expect(service).toContain("if (normalizedDue === \"today\")");
    expect(service).toContain("if (normalizedDue === \"unscheduled\")");
    expect(service).toContain("if (normalizedCompleted !== \"recent\") return");
    expect(service).toContain("where.completedAt = null");
    expect(activityWorkflow).toContain("buildActivityAgenda");
    expect(activityWorkflow).toContain("getNextActivityForRecord");
    expect(activitiesPage).toContain("getActivityWorkQueueSummary(actor)");
    expect(activitiesPage).toContain("Due today");
    expect(activitiesPage).toContain("No due date");
    expect(activitiesPage).toContain("Completed recently");
    expect(activitiesPage).toContain("Open total");
    expect(activitiesPage).toContain("activityQuickLinkHref({ status: \"open\", due: \"overdue\" })");
    expect(activitiesPage).toContain("activityQuickLinkHref({ status: \"open\", due: \"today\" })");
    expect(activitiesPage).toContain("activityQuickLinkHref({ status: \"open\", due: \"upcoming\" })");
    expect(activitiesPage).toContain("activityQuickLinkHref({ status: \"open\", due: \"unscheduled\" })");
    expect(activitiesPage).toContain("activityQuickLinkHref({ status: \"completed\", completed: \"recent\" })");
    expect(activitiesPage).toContain("StatCard");
    expect(statCard).toContain("className=\"stat-card-link\"");
    expect(activitiesPage).toContain("View ${label.toLowerCase()} activities");
    expect(activitiesPage).toContain("Open activities");
    expect(activitiesPage).toContain("Completed activities");
    expect(activitiesPage).toContain("Open overdue");
    expect(activitiesPage).toContain("Open due today");
    expect(activitiesPage).toContain("Open upcoming");
    expect(activitiesPage).toContain("Open with no due date");
    expect(activitiesPage).toContain("Completed in the last 7 days");
    expect(activitiesPage).toContain("ListPageHeaderActions");
    expect(activitiesPage).toContain("resource=\"activities\"");
    expect(activitiesPage).toContain("matchingCount={activityPage.total}");
    expect(activitiesPage).toContain("searchParams={params}");
    expect(activitiesPage).toContain("q: getSearchParam(params, \"q\") || undefined");
    expect(activitiesPage).toContain("name=\"q\"");
    expect(activitiesPage).toContain('placeholder={listResourceSearchPlaceholder("activities")}');
    expect(activitiesPage).toContain('legend="Activity filters"');
    expect(activitiesPage).toContain("Due filters show open activities only.");
    expect(activitiesPage).toContain("const selectedStatus = selectedActivityStatus(params)");
    expect(activitiesPage).toContain("defaultValue={selectedStatus}");
    expect(activitiesPage).toContain("return getSearchParam(params, \"due\") ? \"open\" : \"\"");
    expect(activitiesPage).toContain("Quick activity links");
    expect(activitiesPage).toContain("Due quick links show open activities only.");
    expect(activitiesPage).toContain("buildActivityQuickLinks(actorUserId)");
    expect(activitiesPage).toContain("PanelTitleRow");
    expect(activitiesPage).toContain("title=\"My Day Agenda\"");
    expect(activitiesPage).toContain("titleId=\"activity-agenda-title\"");
    expect(activitiesPage).toContain("description=\"A quick look at what needs action before using filters below.\"");
    expect(activitiesPage).toContain("const addActivityActionLabel = \"Add activity from My Day Agenda\"");
    expect(activitiesPage).toContain("aria-label={addActivityActionLabel}");
    expect(activitiesPage).toContain("title={addActivityActionLabel}");
    expect(compactTitleRow).toContain("export function CompactTitleRow");
    expect(compactTitleRow).toContain("import { useId, type ReactNode } from \"react\"");
    expect(compactTitleRow).toContain("className=\"panel-title-copy\"");
    expect(compactTitleRow).toContain("className=\"compact-title\"");
    expect(compactTitleRow).toContain("titleId?: string");
    expect(compactTitleRow).toContain("const generatedTitleId = useId()");
    expect(compactTitleRow).toContain("const resolvedTitleId = titleId ?? `${generatedTitleId}-compact-title`");
    expect(compactTitleRow).toContain("id={resolvedTitleId}");
    expect(compactTitleRow).toContain("actionsLabel = \"Panel actions\"");
    expect(compactTitleRow).toContain("const resolvedActionsLabel");
    expect(compactTitleRow).toContain("actionsLabel === \"Panel actions\" && typeof title === \"string\" ? `${title} actions` : actionsLabel");
    expect(compactTitleRow).toContain("import { ActionGroup }");
    expect(compactTitleRow).toContain("<ActionGroup className=\"panel-title-actions\" label={resolvedActionsLabel}>");
    expect(globalStyles).toContain(".compact-title");
    expect(globalStyles).toContain("overflow-wrap: anywhere");
    expect(activitiesPage).toContain("CompactTitleRow");
    expect(activitiesPage).toContain("const activityCountLabel = `${section.activities.length} ${section.title.toLowerCase()} ${");
    expect(activitiesPage).toContain('import { CountBadge } from "@/components/count-badge"');
    expect(activitiesPage).toContain('<CountBadge className="badge" label={activityCountLabel}>');
    expect(activitiesPage).toContain("actionsLabel={`${section.title} activity count`}");
    expect(activitiesPage).not.toContain("<h3 className=\"compact-title\">{section.title}</h3>");
    expect(activitiesPage).toContain("<EmptyState className=\"empty-state-compact activity-agenda-empty\" title={section.empty} />");
    expect(activitiesPage).not.toContain("<p className=\"empty-copy\">{section.empty}</p>");
    expect(activitiesPage).toContain("Any related record");
    expect(activitiesPage).toContain("No activities match this search or these filters. Clear filters to return to the full work queue.");
    expect(activitiesPage).toContain("No activities yet. Create a follow-up to plan the next call, email, meeting, or task.");
    expect(activityList).toContain("ActivityDueBadge");
    expect(activityList).toContain("formatActivityType(activity.type)");
    expect(activityList).toContain("TimelineMetaRow");
    expect(activityList).toContain("activity-item activity-item-open");
    expect(activityList).toContain("const stateLabel = timing.isOpen ? \"Open follow-up\" : \"Completed follow-up\"");
    expect(activityList).toContain("activity-row-header");
    expect(activityList).toContain("activity-title-group");
    expect(activityList).toContain("ariaLabel={`${activity.title} activity metadata`}");
    expect(activityList).toContain("activity-context-line");
    expect(activityList).toContain("stateLabel");
    expect(activityList).toContain("activityOwnerMetaLabel(activity.owner)");
    expect(activityList).toContain('import { recordOwnerLabel } from "@/lib/record-owner-label"');
    expect(activityList).toContain("export function activityOwnerMetaLabel");
    expect(activityList).toContain("return recordOwnerLabel(owner)");
    expect(recordOwnerLabel).toContain("return owner ? `Owner: ${owner.name ?? owner.email}` : \"Owner: Unassigned\"");
    expect(activityList).toContain("summarizeActivityTiming(activity)");
    expect(activityList).toContain("Next follow-up");
    expect(activityList).toContain("buildActivityFollowUpHref");
    expect(activityList).toContain("const activityActionsLabel = `${activity.title} activity actions`");
    expect(activityList).toContain("import { ActionGroup }");
    expect(activityList).toContain('<ActionGroup className="activity-actions" label={activityActionsLabel}>');
    expect(activityList.indexOf("showCompleteAction && !activity.completedAt")).toBeLessThan(activityList.indexOf("aria-label={`Edit activity ${activity.title}`}"));
    expect(activityList).toContain("aria-label={`Edit activity ${activity.title}`}");
    expect(activityList).toContain("aria-label={`View completed activity ${activity.title}`}");
    expect(activityList).toContain("aria-label={`Create next follow-up after ${activity.title}`}");
    expect(activityList).toContain("ariaLabel={`Mark activity ${activity.title} complete`}");
    expect(activityList).toContain("ActivityRelatedLinks");
    expect(activityList).toContain('import { InlineEmptyStateText } from "@/components/inline-empty-state-text"');
    expect(activityList).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(activityList).toContain('formatPersonName(activity.person) ?? "Unnamed contact"');
    expect(activityList).not.toContain("function formatPersonName");
    expect(personName).toContain("export function formatPersonName");
    expect(activityList).toContain("aria-label={`${activity.title} related records`}");
    expect(activityList).toContain('<InlineEmptyStateText className="activity-related-empty">No related CRM record linked</InlineEmptyStateText>');
    expect(activityList).toContain("const relatedRecordLabel = `Open ${link.type.toLowerCase()} ${link.label} from activity ${activity.title}`");
    expect(activityList).toContain("aria-label={relatedRecordLabel}");
    expect(activityList).toContain("title={relatedRecordLabel}");
    expect(activityList).toContain("className=\"field-link\"");
    expect(dueBadge).toContain("const label = formatActivityDueBadgeLabel(bucket, activity)");
    expect(dueBadge).toContain('import { Badge } from "@/components/badge"');
    expect(dueBadge).toContain("const accessibleLabel = `Due status: ${label}`");
    expect(dueBadge).toContain("export function formatActivityDueBadgeLabel");
    expect(dueBadge).toContain("<Badge className={`activity-due activity-due-${bucket}`} label={accessibleLabel}>");
    expect(dueBadge).toContain("activity-due-${bucket}");
    expect(dueBadge).toContain("Due today");
    expect(dueBadge).toContain("Due ${formatDate(activity.dueAt)}");
    expect(globalStyles).toContain("activity-due-overdue");
    expect(globalStyles).toContain("activity-due-unscheduled");
    expect(globalStyles).toContain(".section-spaced");
    expect(globalStyles).toContain(".activity-item-open .activity-icon");
    expect(globalStyles).toContain(".activity-agenda-section .activity-item");
    expect(globalStyles).toContain(".activity-agenda-section .activity-icon");
    expect(globalStyles).toContain(".activity-row-header");
    expect(globalStyles).toContain(".activity-actions > *");
    expect(globalStyles).toContain(".activity-related-links");
    expect(globalStyles).toContain(".activity-related-empty");
    expect(globalStyles).toContain("min-width: min(100%, 180px)");
    expect(globalStyles).toContain("display: block;");
    expect(completeButton).toContain("const [isComplete, setIsComplete] = useState(false)");
    expect(completeButton).toContain("if (isSaving || isComplete) return");
    expect(completeButton).toContain("setIsComplete(true)");
    expect(completeButton).toContain("disabled={isSaving || isComplete}");
    expect(completeButton).toContain('isComplete ? "Completed" : isSaving ? "Saving..." : "Complete"');
    expect(activitiesPage).not.toContain('from "@/lib/services/crm"');
    expect(activitiesPage).toContain('from "@/lib/services/activity-service"');
    expect(activitiesPage).toContain('from "@/lib/services/workspace-service"');
    expect(activitiesPage).toContain('from "@/lib/services/crm-ai-insight-service"');
  });

  it("builds activity quick links from existing URL filters while resetting page number", () => {
    expect(buildActivityQuickLinks("user_123")).toEqual([
      { label: "My open", href: "/activities?status=open&ownerId=user_123" },
      { label: "Overdue", href: "/activities?status=open&due=overdue" },
      { label: "Due today", href: "/activities?status=open&due=today" },
      { label: "Upcoming", href: "/activities?status=open&due=upcoming" },
      { label: "No due date", href: "/activities?status=open&due=unscheduled" },
      { label: "Completed recently", href: "/activities?status=completed&completed=recent" }
    ]);
    expect(activityQuickLinkHref({ status: "open", ownerId: "user_123" })).not.toContain("page=");
    expect(activityQuickLinkHref({ status: "open", due: "today" })).toBe("/activities?status=open&due=today");
    expect(activityQuickLinkHref({ status: "completed", completed: "recent" })).toBe(
      "/activities?status=completed&completed=recent"
    );
    expect(activityQuickLinkHref({ status: "open", due: "unscheduled" })).toBe("/activities?status=open&due=unscheduled");
    expect(activityQuickLinkHref({ status: "open", due: "overdue" })).not.toContain("ownerId=");
    expect(activityQuickLinkHref({ status: "open", due: "upcoming" })).not.toContain("related=");
  });

  it("adds soft-delete actions for open activities only wherever activity lists render", () => {
    expect(activityList).toContain("ActivityDeleteButton");
    expect(activityList).toContain("ariaLabel={`Remove activity ${activity.title}`}");
    expect(activityList).toContain("{!activity.completedAt ? (");
    expect(deleteButton).toContain("ariaLabel?: string");
    expect(deleteButton).toContain("aria-label={ariaLabel}");
    expect(deleteButton).toContain("title={ariaLabel}");
    expect(deleteButton).toContain("method: \"DELETE\"");
    expect(deleteButton).toContain("/api/v1/workspaces/${workspaceId}/activities/${activityId}");
    expect(deleteButton).toContain("router.refresh()");
  });

  it("lets contact, organization, and lead detail pages create and complete activities", () => {
    expect(contactDetailPage).toContain("RecordActivitiesPanel");
    expect(contactDetailPage).toContain("attachment={{ personId: person.id }}");
    expect(contactDetailPage).toContain("addHref={\"#add-activity\" as Route}");
    expect(contactDetailPage).toContain("formId=\"add-activity\"");
    expect(contactDetailPage).toContain("RecordPanelJumpNav");
    expect(recordPanelJumpNav).toContain("href: \"#activities\" as Route");
    expect(contactDetailPage).toContain('recordActivitySectionCopy("contact")');
    expect(recordActivityCopy).toContain("Open and completed follow-ups linked to this contact.");
    expect(contactDetailPage).toContain("showCompleteAction");
    expect(organizationDetailPage).toContain("RecordActivitiesPanel");
    expect(organizationDetailPage).toContain("attachment={{ organizationId: organization.id }}");
    expect(organizationDetailPage).toContain("addHref={\"#add-activity\" as Route}");
    expect(organizationDetailPage).toContain("formId=\"add-activity\"");
    expect(organizationDetailPage).toContain("RecordPanelJumpNav");
    expect(organizationDetailPage).toContain('recordActivitySectionCopy("organization")');
    expect(recordActivityCopy).toContain("Open and completed follow-ups linked to this organization.");
    expect(organizationDetailPage).toContain("showCompleteAction");
    expect(leadDetailPage).toContain("RecordActivitiesPanel");
    expect(leadDetailPage).toContain("attachment={{ leadId: lead.id }}");
    expect(leadDetailPage).toContain("addHref={\"#add-activity\" as Route}");
    expect(leadDetailPage).toContain("addLockedLabel=\"Activity locked\"");
    expect(leadDetailPage).toContain("formId=\"add-activity\"");
    expect(leadDetailPage).toContain("RecordPanelJumpNav");
    expect(leadDetailPage).toContain('recordActivitySectionCopy("lead")');
    expect(recordActivityCopy).toContain("Open and completed follow-ups linked to this lead.");
    expect(leadDetailPage).toContain("showCompleteAction: lead.status !== \"CONVERTED\"");
    expect(recordActivitiesPanel).toContain("ActivityForm");
  });

  it("blocks activity creation UI for converted leads and keeps global completion available", () => {
    expect(leadDetailPage).toContain("lead.status === \"CONVERTED\"");
    expect(leadDetailPage).toContain('lockedMessage={convertedLeadLockMessage("activities")}');
    expect(recordActivitiesPanel).toContain("const addActivityHref = showForm && formId ? `#${formId}` : undefined");
    expect(activitiesPage).toContain("showCompleteAction");
    expect(activitiesPage).toContain("workspaceId={workspace.id}");
  });

  it("keeps pipeline next activity based on incomplete deal activities", () => {
    expect(service).toContain("completedAt: null");
    expect(service).toContain("nulls: \"last\"");
    expect(service).toContain("take: 1");
  });

  it("normalizes missing-next-activity service limits before querying Prisma", () => {
    expect(service).toContain("normalizeMissingNextActivityTake(take)");
    expect(service).toContain("Number.isFinite(take)");
    expect(service).toContain("maxMissingNextActivityTake");
  });

  it("fails closed for malformed activity related filter and missing-next record types", () => {
    expect(service).toContain("normalizeActivityRelatedType(filters.relatedType)");
    expect(service).toContain("Activity related type must be deal, lead, person, or organization.");
    expect(service).toContain("normalizeMissingNextActivityRecordType(recordType)");
    expect(service).toContain("Missing-next-activity record type must be deal or lead.");
  });

  it("validates activity date fields before service writes", () => {
    expect(service).toContain("normalizeNullableDateValue(input.dueAt, \"Activity due date is invalid.\")");
    expect(service).toContain("normalizeNullableDateValue(input.completedAt, \"Activity completed date is invalid.\")");
    expect(service).toContain("Activity due date is invalid.");
    expect(service).toContain("Activity completed date is invalid.");
  });

  it("surfaces next open activity on the Deals list", () => {
    expect(dealsPage).toContain("<th>Next activity</th>");
    expect(dealsPage).toContain("ListNextActivitySummary");
    expect(dealsPage).toContain("deal.activities[0]");
    expect(listNextActivitySummary).toContain("export function ListNextActivitySummary");
    expect(listNextActivitySummary).toContain("No open activity");
    expect(listNextActivitySummary).toContain("ActivityDueBadge");
    expect(listNextActivitySummary).toContain("next-activity-summary");
  });
});
