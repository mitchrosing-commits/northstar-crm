import Link from "next/link";
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
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildPublicSchedulerUrl } from "@/lib/public-url";
import { defaultSchedulerAvailability, listSchedulerLinks } from "@/lib/services/crm";
import { createSchedulerLinkAction, setSchedulerLinkEnabledAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ created?: string; disabled?: string; enabled?: string }>;
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

export default async function SchedulerPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const schedulerLinks = await listSchedulerLinks(actor);
  const defaultAvailability = defaultSchedulerAvailability();

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Booking links"
        subtitle="Create public scheduling links from Northstar-configured availability. Bookings create meeting activities only, without calendar sync or workflow automation."
        title="Scheduler"
      />

      {query?.created === "1" ? (
        <FormSuccessMessage className="section-separated">Scheduling link created. Copy the public link when you are ready to share it.</FormSuccessMessage>
      ) : null}
      {query?.enabled === "1" ? <FormSuccessMessage className="section-separated">Scheduling link enabled.</FormSuccessMessage> : null}
      {query?.disabled === "1" ? (
        <FormSuccessMessage className="section-separated">Scheduling link disabled. Its public page now shows an unavailable state.</FormSuccessMessage>
      ) : null}

      <section className="panel section-separated">
        <PanelTitleRow
          description="Set the meeting copy and weekly availability Northstar should offer. Public choices do not check external calendar providers."
          title="Create Scheduling Link"
        />
        <form action={createSchedulerLinkAction} className="scheduler-builder-grid">
          <label className="form-field">
            <FormFieldLabel required>Internal name</FormFieldLabel>
            <input maxLength={120} name="name" placeholder="Discovery call" required />
          </label>
          <label className="form-field">
            <FormFieldLabel required>Meeting title</FormFieldLabel>
            <input maxLength={160} name="meetingTitle" placeholder="Intro meeting" required />
          </label>
          <label className="form-field">
            <FormFieldLabel required>Duration</FormFieldLabel>
            <select defaultValue="30" name="durationMinutes" required>
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
            <input maxLength={80} name="timezone" placeholder="America/New_York" required defaultValue="America/New_York" />
          </label>
          <label className="form-field">
            <FormFieldLabel>Minimum notice</FormFieldLabel>
            <select defaultValue="60" name="minimumNoticeMinutes">
              <option value="0">None</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="1440">1 day</option>
              <option value="2880">2 days</option>
            </select>
          </label>
          <label className="form-field scheduler-field-wide">
            <FormFieldLabel>Description</FormFieldLabel>
            <textarea maxLength={800} name="description" placeholder="Share context guests should see before booking." rows={3} />
          </label>
          <fieldset className="scheduler-availability-fieldset scheduler-field-wide">
            <legend>Weekly availability</legend>
            <div className="scheduler-availability-grid">
              {weekdays.map((day) => {
                const defaultWindow = defaultAvailability.find((window) => window.weekday === day.value);
                return (
                  <div className="scheduler-availability-row" key={day.value}>
                    <label className="checkbox-field">
                      <input
                        defaultChecked={Boolean(defaultWindow)}
                        name={`availability-${day.value}-enabled`}
                        type="checkbox"
                      />
                      <span>{day.label}</span>
                    </label>
                    <label className="form-field">
                      <span className="form-field-label">
                        <span>{day.label} start</span>
                      </span>
                      <input defaultValue={defaultWindow?.start ?? "09:00"} name={`availability-${day.value}-start`} type="time" />
                    </label>
                    <label className="form-field">
                      <span className="form-field-label">
                        <span>{day.label} end</span>
                      </span>
                      <input defaultValue={defaultWindow?.end ?? "17:00"} name={`availability-${day.value}-end`} type="time" />
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="form-actions scheduler-field-wide">
            <button className="button-primary" type="submit">
              Create scheduling link
            </button>
          </div>
        </form>
      </section>

      {schedulerLinks.length > 0 ? (
        <section className="panel">
          <PanelTitleRow
            actions={<Badge label={`${schedulerLinks.length} scheduling links`}>{schedulerLinks.length}</Badge>}
            description="Enabled links accept public booking requests. Disabled links return a safe unavailable page."
            title="Scheduling Links"
          />
          <TableScroll aria-label="Scheduling links table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Timezone</th>
                  <th>Bookings</th>
                  <th>Recent activity</th>
                  <th>Public link</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedulerLinks.map((schedulerLink) => {
                  const publicUrl = buildPublicSchedulerUrl(schedulerLink.token);
                  return (
                    <tr key={schedulerLink.id}>
                      <td data-label="Link">
                        <span className="table-primary-cell">
                          <strong>{schedulerLink.name}</strong>
                          <span className="table-secondary-text">{schedulerLink.meetingTitle}</span>
                        </span>
                      </td>
                      <td data-label="Status">
                        <Badge label={`Scheduling link status: ${schedulerLink.isEnabled ? "Enabled" : "Disabled"}`}>
                          {schedulerLink.isEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </td>
                      <td data-label="Duration">{schedulerLink.durationMinutes} min</td>
                      <td data-label="Timezone">{schedulerLink.timezone}</td>
                      <td data-label="Bookings">{schedulerLink._count.bookings}</td>
                      <td data-label="Recent activity">
                        {schedulerLink.bookings[0]?.requestedAt ? formatDate(schedulerLink.bookings[0].requestedAt) : "No bookings"}
                      </td>
                      <td data-label="Public link">
                        <SchedulerPublicLinkControls
                          isEnabled={schedulerLink.isEnabled}
                          publicUrl={publicUrl}
                          schedulerName={schedulerLink.name}
                        />
                      </td>
                      <td className="table-actions-cell" data-label="Actions">
                        <a className="button-secondary button-compact" href={publicUrl} rel="noreferrer" target="_blank">
                          Open
                        </a>
                        <Link className="button-secondary button-compact" href={`/scheduler/${schedulerLink.id}` as Route}>
                          View
                        </Link>
                        <form action={setSchedulerLinkEnabledAction}>
                          <input name="schedulerLinkId" type="hidden" value={schedulerLink.id} />
                          <input name="enabled" type="hidden" value={schedulerLink.isEnabled ? "false" : "true"} />
                          <button className="button-secondary button-compact" type="submit">
                            {schedulerLink.isEnabled ? "Disable" : "Enable"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </section>
      ) : (
        <EmptyState
          as="section"
          className="empty-state-panel"
          description="Create your first public scheduling link, then share it with prospects or customers who need to request a meeting."
          title="No scheduling links yet"
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}
