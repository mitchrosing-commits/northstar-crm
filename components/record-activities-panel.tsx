import { ActivityForm } from "@/components/activity-form";
import { ActivityList } from "@/components/activity-list";

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
  emptyMessage: string;
  showCompleteAction?: boolean;
  title: string;
};

type RecordActivitiesPanelProps = {
  attachment: ActivityAttachment;
  defaultOwnerId?: string;
  formId?: string;
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
  lockedMessage,
  owners,
  sections,
  showForm = true,
  workspaceId
}: RecordActivitiesPanelProps) {
  return (
    <>
      <section className="data-card" id={formId} style={{ marginTop: 14 }}>
        <h2 className="panel-title">Add Activity</h2>
        {showForm ? (
          <ActivityForm
            attachment={attachment}
            defaultOwnerId={defaultOwnerId}
            owners={owners}
            workspaceId={workspaceId}
          />
        ) : (
          <p className="empty-copy">{lockedMessage}</p>
        )}
      </section>

      {sections.length > 1 ? (
        <section className="detail-grid" style={{ marginTop: 14 }}>
          {sections.map((section) => (
            <ActivitySectionCard key={section.title} section={section} workspaceId={workspaceId} />
          ))}
        </section>
      ) : (
        sections.map((section) => (
          <section className="data-card" key={section.title} style={{ marginTop: 14 }}>
            <ActivitySectionContent section={section} workspaceId={workspaceId} />
          </section>
        ))
      )}
    </>
  );
}

function ActivitySectionCard({ section, workspaceId }: { section: ActivitySection; workspaceId: string }) {
  return (
    <div className="data-card">
      <ActivitySectionContent section={section} workspaceId={workspaceId} />
    </div>
  );
}

function ActivitySectionContent({ section, workspaceId }: { section: ActivitySection; workspaceId: string }) {
  return (
    <>
      <h2 className="panel-title">{section.title}</h2>
      {section.activities.length > 0 ? (
        <ActivityList
          activities={section.activities}
          showCompleteAction={section.showCompleteAction}
          workspaceId={workspaceId}
        />
      ) : (
        <p className="empty-copy">{section.emptyMessage}</p>
      )}
    </>
  );
}
