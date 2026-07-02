import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { CompactList } from "@/components/compact-list";
import { EmptyState } from "@/components/empty-state";
import { MeetingIntelligenceForm } from "@/components/meeting-intelligence-form";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/components/format";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getMeetingIntelligenceOptions, listMeetingIntakes } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function MeetingIntelligencePage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [options, intakes] = await Promise.all([getMeetingIntelligenceOptions(actor), listMeetingIntakes(actor)]);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Meeting intelligence"
        subtitle="Turn meeting artifacts into reviewable CRM updates for notes, completed meetings, and follow-ups."
        title="Meeting Intelligence"
      />

      <section className="panel section-separated" aria-labelledby="meeting-intake-create-heading">
        <PanelTitleRow title="New intake" titleId="meeting-intake-create-heading" />
        <MeetingIntelligenceForm options={options} workspaceId={workspace.id} />
      </section>

      <section className="panel" aria-labelledby="recent-intakes-heading">
        <PanelTitleRow title="Recent intakes" titleId="recent-intakes-heading" />
        {intakes.length > 0 ? (
          <CompactList className="meeting-intake-list">
            {intakes.map((intake) => (
              <Link className="meeting-intake-row" href={`/meeting-intelligence/${intake.id}` as Route} key={intake.id}>
                <span>
                  <strong>{intake.originalFilename ?? sourceTypeLabel(intake.sourceType)}</strong>
                  <small>{formatDate(intake.createdAt)}</small>
                </span>
                <StatusBadge status={intake.status.replaceAll("_", " ")} />
              </Link>
            ))}
          </CompactList>
        ) : (
          <EmptyState
            className="empty-state-compact"
            description="Analyzed intakes will appear here after you submit meeting notes or a supported text artifact."
            title="No meeting intakes yet"
            titleLevel="h3"
          />
        )}
      </section>
    </AppShell>
  );
}

function sourceTypeLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
