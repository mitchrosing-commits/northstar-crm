import { ActivityForm } from "@/components/activity-form";
import { activityManualFollowUpCopy } from "@/components/activity-form-guidance";
import { ActivityList } from "@/components/activity-list";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { PanelTitleRow } from "@/components/panel-title-row";

type ActivityAttachment =
  | { dealId: string }
  | { leadId: string }
  | { personId: string }
  | { organizationId: string };

type OwnerOption = {
  id: string;
  name: string;
};

type Activity = Parameters<typeof ActivityList>[0]["activities"][number];

type ActivitySection = {
  activities: Activity[];
  description?: string;
  emptyMessage: string;
  showCompleteAction?: boolean;
  title: string;
};

type RecordActivitiesPanelProps = {
  attachment: ActivityAttachment;
  defaultOwnerId?: string;
  formId?: string;
  id?: string;
  lockedMessage?: string;
  owners: OwnerOption[];
  sections: ActivitySection[];
  showForm?: boolean;
  workspaceId: string;
};

export function RecordActivitiesPanel({
  attachment,
  defaultOwnerId,
  formId,
  id = "activities",
  lockedMessage,
  owners,
  sections,
  showForm = true,
  workspaceId
}: RecordActivitiesPanelProps) {
  const addActivityHref = showForm && formId ? `#${formId}` : undefined;
  const addActivityLabel = "Add activity from this record";

  return (
    <>
      <section className="data-card section-spaced" id={formId}>
        <PanelTitleRow
          description={activityManualFollowUpCopy}
          title="Add Activity"
        />
        {showForm ? (
          <ActivityForm
            attachment={attachment}
            defaultOwnerId={defaultOwnerId}
            owners={owners}
            workspaceId={workspaceId}
          />
        ) : (
          <LockedPanelNotice>{lockedMessage ?? "Activity creation is locked for this record."}</LockedPanelNotice>
        )}
      </section>

      {sections.length > 1 ? (
        <section className="detail-grid section-spaced" id={id}>
          {sections.map((section) => (
            <ActivitySectionCard
              addActivityHref={addActivityHref}
              addActivityLabel={addActivityLabel}
              key={section.title}
              section={section}
              workspaceId={workspaceId}
            />
          ))}
        </section>
      ) : (
        sections.map((section) => (
          <section className="data-card section-spaced" id={id} key={section.title}>
            <ActivitySectionContent
              addActivityHref={addActivityHref}
              addActivityLabel={addActivityLabel}
              section={section}
              workspaceId={workspaceId}
            />
          </section>
        ))
      )}
    </>
  );
}

function ActivitySectionCard({
  addActivityHref,
  addActivityLabel,
  section,
  workspaceId
}: {
  addActivityHref?: string;
  addActivityLabel: string;
  section: ActivitySection;
  workspaceId: string;
}) {
  return (
    <div className="data-card">
      <ActivitySectionContent
        addActivityHref={addActivityHref}
        addActivityLabel={addActivityLabel}
        section={section}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function ActivitySectionContent({
  addActivityHref,
  addActivityLabel,
  section,
  workspaceId
}: {
  addActivityHref?: string;
  addActivityLabel: string;
  section: ActivitySection;
  workspaceId: string;
}) {
  const activityCountLabel = `${section.activities.length} ${section.title.toLowerCase()} ${
    section.activities.length === 1 ? "activity" : "activities"
  }`;

  return (
    <>
      <PanelTitleRow
        actions={
          <CountBadge label={activityCountLabel}>
            {section.activities.length}
          </CountBadge>
        }
        actionsLabel={`${section.title} activity count`}
        description={section.description ? <span className="record-activity-section-hint">{section.description}</span> : null}
        title={section.title}
      />
      {section.activities.length > 0 ? (
        <ActivityList
          activities={section.activities}
          showCompleteAction={section.showCompleteAction}
          workspaceId={workspaceId}
        />
      ) : (
        <EmptyState
          actions={
            addActivityHref ? (
              <a
                aria-label={addActivityLabel}
                className="button-secondary button-compact"
                href={addActivityHref}
                title={addActivityLabel}
              >
                Add activity
              </a>
            ) : null
          }
          className="empty-state-compact empty-state-panel"
          title={section.emptyMessage}
        />
      )}
    </>
  );
}
