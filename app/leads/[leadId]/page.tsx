import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AiRecordBriefCard } from "@/components/ai-record-brief-card";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { Badge } from "@/components/badge";
import { RecordCustomFieldsPanel } from "@/components/record-custom-fields-panel";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { formatDate } from "@/components/format";
import { LeadConversionForm } from "@/components/lead-conversion-form";
import { ManualEmailLogPanel } from "@/components/manual-email-log-panel";
import { NotesPanel } from "@/components/notes-panel";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { RecordActivitiesPanel } from "@/components/record-activities-panel";
import { getNextOpenActivity, RecordNextActivitySummary } from "@/components/record-next-activity-summary";
import { RecordHeaderActions } from "@/components/record-header-actions";
import { RecordPanelJumpNav } from "@/components/record-panel-jump-nav";
import { RecordSummary } from "@/components/record-summary";
import { RecordTimeline } from "@/components/record-timeline";
import { StatusBadge } from "@/components/status-badge";
import { createLeadAutomationActivityAction } from "@/app/leads/actions";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import { recordActivitySectionCopy } from "@/lib/record-activity-copy";
import { convertedLeadLockedLabel, convertedLeadLockMessage } from "@/lib/record-lock-copy";
import { recordSubtitle } from "@/lib/record-subtitle";
import {
  buildAiRecordBrief,
  buildLeadAssistantContext,
  buildNorthstarAssistantInsight,
  getAiPreferences,
  getLead,
  getRecordTimeline,
  getWorkspace,
  listEmailTemplates,
  listLeadCustomFields,
  listPipelines
} from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ leadId: string }>;
};

export default async function LeadDetailPage({ params }: PageProps) {
  const { leadId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const lead = await getLead(actor, leadId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [pipelines, workspaceDetail, timelineItems, customFields, emailTemplates, northstarContext, aiPreferences] = await Promise.all([
    listPipelines(actor),
    getWorkspace(actor),
    getRecordTimeline(actor, { type: "LEAD", id: lead.id }),
    listLeadCustomFields(actor, lead.id),
    listEmailTemplates(actor, { activeOnly: true }),
    buildLeadAssistantContext(actor, lead.id),
    getAiPreferences(actor)
  ]);
  const northstarInsight = await buildNorthstarAssistantInsight(northstarContext, { preferences: aiPreferences });
  const aiRecordBrief = buildAiRecordBrief(northstarContext, northstarInsight, aiPreferences);
  const owners = workspaceDetail.memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name ?? membership.user.email
  }));
  const nextActivity = getNextOpenActivity(lead.activities);
  const activityCopy = recordActivitySectionCopy("lead");
  const emailLogCount = timelineItems.filter((item) => item.type === "email").length;
  const outreachActionLabel = `Create outreach: create first outreach activity for ${lead.title}`;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <RecordHeaderActions
            addHref={"#add-activity" as Route}
            addLockedLabel="Activity locked"
            backHref="/leads"
            backLabel="Back to leads"
            customFieldsHref={"#custom-fields" as Route}
            editHref={lead.status !== "CONVERTED" ? (`/leads/${lead.id}/edit` as Route) : undefined}
            editLabel="Edit lead"
            leadingActions={<StatusBadge status={lead.status} />}
            locked={lead.status === "CONVERTED"}
            lockedLabel={convertedLeadLockedLabel}
            noteHref={"#notes" as Route}
            noteLockedLabel="Notes locked"
            recordTitle={lead.title}
          />
        }
        eyebrow="Lead"
        subtitle={recordSubtitle([lead.source, lead.owner?.name ?? lead.owner?.email, lead.organization?.name ?? formatPersonName(lead.person)])}
        title={lead.title}
      />

      <RecordSummary
        actions={
          <RecordPanelJumpNav
            counts={{
              activities: lead.activities.length,
              auditHistory: lead.auditLogs.length,
              customFields: customFields.length,
              emailLog: emailLogCount,
              notes: lead.notes.length,
              timeline: timelineItems.length
            }}
            ariaLabel={`${lead.title} lead sections`}
            jumps={[
              { href: "#overview" as Route, label: "Overview" },
              {
                href: "#ai-record-brief" as Route,
                label: "AI brief",
                count: northstarInsight.findings.length,
                countLabel: { singular: "AI finding", plural: "AI findings" }
              },
              { href: "#convert-lead" as Route, label: "Conversion" },
              {
                href: "#notes" as Route,
                label: "Notes",
                countKey: "notes",
                countLabel: { singular: "note", plural: "notes" }
              },
              {
                href: "#activities" as Route,
                label: "Activities",
                countKey: "activities",
                countLabel: { singular: "activity", plural: "activities" }
              },
              {
                href: "#email-log" as Route,
                label: "Emails",
                countKey: "emailLog",
                countLabel: { singular: "email log", plural: "email logs" }
              },
              {
                href: "#custom-fields" as Route,
                label: "Custom fields",
                countKey: "customFields",
                countLabel: { singular: "custom field", plural: "custom fields" }
              },
              {
                href: "#timeline" as Route,
                label: "Timeline",
                countKey: "timeline",
                countLabel: { singular: "timeline event", plural: "timeline events" }
              },
              {
                href: "#audit-history" as Route,
                label: "History",
                countKey: "auditHistory",
                countLabel: { singular: "audit event", plural: "audit events" }
              }
            ]}
            label="Sections"
          />
        }
        eyebrow="Lead readiness"
        items={[
          { label: "Status", value: <StatusBadge status={lead.status} />, tone: lead.status === "CONVERTED" ? "success" : "default" },
          { label: "Activities", value: lead.activities.length, tone: lead.status !== "CONVERTED" && lead.activities.length === 0 ? "warning" : "default" },
          { label: "Owner", value: lead.owner?.name ?? lead.owner?.email ?? "Unassigned", tone: lead.owner ? "default" : "muted" },
          {
            label: "Next follow-up",
            value: <RecordNextActivitySummary activity={nextActivity} emptyBadgeLabel={lead.status === "CONVERTED" ? undefined : "Needs follow-up"} emptyLabel="No open lead follow-up" />,
            tone: nextActivity ? "default" : lead.status === "CONVERTED" ? "muted" : "warning"
          },
          { label: "Notes", value: lead.notes.length },
          {
            label: "Conversion",
            value: lead.status === "CONVERTED" ? "Locked after conversion" : "Ready when qualified",
            tone: lead.status === "CONVERTED" ? "muted" : "default"
          }
        ]}
        title="Lead workspace"
      />

      <AiRecordBriefCard brief={aiRecordBrief} />

      {lead.status !== "CONVERTED" && lead.activities.length === 0 ? (
        <section className="data-card automation-template-panel section-separated">
          <PanelTitleRow actions={<Badge>Creates activity</Badge>} eyebrow="Suggested Automation" title="First outreach" />
          <FormIntroCallout title="Suggested next step">
            Create a first outreach activity for this lead. This is a one-click template, not an automatic rule.
          </FormIntroCallout>
          <form action={createLeadAutomationActivityAction} className="automation-template-item">
            <input name="leadId" type="hidden" value={lead.id} />
            <div>
              <strong>Lead first outreach</strong>
              <p>Schedule a call for tomorrow so the lead has a clear next step.</p>
            </div>
            <button
              aria-label={outreachActionLabel}
              className="button-secondary button-compact"
              title={outreachActionLabel}
              type="submit"
            >
              Create outreach
            </button>
          </form>
        </section>
      ) : null}

      <section className="detail-grid" id="overview">
        <DetailFieldGrid
          fields={[
            { emptyLabel: "No source", label: "Source", value: lead.source },
            { label: "Created", value: formatDate(lead.createdAt) },
            { label: "Owner", value: lead.owner?.name ?? lead.owner?.email ?? "Unassigned" },
            {
              emptyLabel: "No contact",
              label: "Person",
              value: lead.person ? (
                <Link className="inline-link" href={`/contacts/${lead.person.id}`}>
                  {formatPersonName(lead.person) ?? "Unnamed contact"}
                </Link>
              ) : (
                null
              )
            },
            {
              emptyLabel: "No organization",
              label: "Organization",
              value: lead.organization ? (
                <Link className="inline-link" href={`/organizations/${lead.organization.id}`}>
                  {lead.organization.name}
                </Link>
              ) : (
                null
              )
            }
          ]}
        />
        <div className="data-card" id="convert-lead">
          <PanelTitleRow title="Convert to Deal" />
          <FormIntroCallout title="Conversion path">
            Create a deal from this lead in a selected pipeline stage. Linked activities, notes, and email logs will
            move to the new deal timeline, then Northstar opens the converted deal so you can add the next sales step.
          </FormIntroCallout>
          {!lead.person && !lead.organization ? (
            <FormIntroCallout className="lead-conversion-note" title="Relationship check">
              This lead has no linked contact or organization yet. You can still convert it now, or add those details first
              if you want the new deal linked from day one.
            </FormIntroCallout>
          ) : null}
          <div className="section-spaced">
            <LeadConversionForm
              leadId={lead.id}
              leadStatus={lead.status}
              leadTitle={lead.title}
              pipelines={pipelines.map((pipeline) => ({
                id: pipeline.id,
                name: pipeline.name,
                stages: pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }))
              }))}
              workspaceId={workspace.id}
            />
          </div>
        </div>
      </section>

      <NotesPanel
        attachment={{ leadId: lead.id }}
        emptyMessage="No notes are linked to this lead."
        lockedMessage={convertedLeadLockMessage("notes")}
        notes={lead.notes}
        showDeleteActions={lead.status !== "CONVERTED"}
        showForm={lead.status !== "CONVERTED"}
        workspaceId={workspace.id}
      />

      <RecordActivitiesPanel
        attachment={{ leadId: lead.id }}
        defaultOwnerId={actorUserId}
        formId="add-activity"
        lockedMessage={convertedLeadLockMessage("activities")}
        owners={owners}
        sections={[
          {
            activities: lead.activities,
            description: activityCopy.description,
            emptyMessage: activityCopy.emptyMessage,
            showCompleteAction: lead.status !== "CONVERTED",
            title: activityCopy.title
          }
        ]}
        showForm={lead.status !== "CONVERTED"}
        workspaceId={workspace.id}
      />

      <RecordCustomFieldsPanel
        emptyMessage="No lead custom fields have been created yet."
        entityId={lead.id}
        entityType="LEAD"
        fields={customFields}
        lockedMessage={convertedLeadLockMessage("customFields")}
        readOnly={lead.status === "CONVERTED"}
        workspaceId={workspace.id}
      />

      <ManualEmailLogPanel
        attachment={{ leadId: lead.id }}
        lockedMessage={convertedLeadLockMessage("emailLogs")}
        showForm={lead.status !== "CONVERTED"}
        templates={emailTemplates}
        workspaceId={workspace.id}
      />

      <RecordTimeline items={timelineItems} />

      <AuditHistoryPanel
        emptyMessage="No audit events have been recorded for this lead yet."
        entries={lead.auditLogs}
      />
    </AppShell>
  );
}
