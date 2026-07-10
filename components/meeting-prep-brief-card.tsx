import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { PanelTitleRow } from "@/components/panel-title-row";
import type {
  MeetingPrepAttendeeCandidate,
  MeetingPrepAttendeeConfidence,
  MeetingPrepBrief,
  MeetingPrepBriefItem,
  MeetingPrepBriefSourceRef,
  MeetingPrepManualAction
} from "@/lib/services/meeting-prep-brief-service";

type MeetingPrepBriefCardProps = {
  brief: MeetingPrepBrief;
};

export function MeetingPrepBriefCard({ brief }: MeetingPrepBriefCardProps) {
  return (
    <section aria-label="Meeting prep brief" className="data-card meeting-prep-brief-card section-spaced" id="meeting-prep-brief">
      <PanelTitleRow
        actions={
          <>
            <Badge>Read-only</Badge>
            <Badge>Review-first</Badge>
          </>
        }
        description="A concise preparation view from workspace-scoped CRM records. Suggestions are separate from stored facts, and viewing this does not change CRM data."
        eyebrow="Meeting Prep"
        title={brief.activity.title}
      />

      <div className="meeting-prep-summary-grid" aria-label="Meeting basics">
        <div>
          <span>Date and time</span>
          <strong>{brief.activity.dueAt ? formatMeetingTime(brief.activity.dueAt) : "Not scheduled"}</strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>{brief.activity.ownerLabel}</strong>
        </div>
        <div>
          <span>Attendees</span>
          <strong>{brief.attendeeConfidence.length > 0 ? brief.attendeeConfidence.map((attendee) => attendee.label).join(", ") : "No attendee context"}</strong>
        </div>
        <div>
          <span>Source activity</span>
          <Link className="inline-link" href={brief.activity.href as Route}>
            Open activity
          </Link>
        </div>
      </div>

      {brief.linkedRecords.length > 0 ? (
        <div className="meeting-prep-linked-records" aria-label="Linked CRM records">
          {brief.linkedRecords.map((record) => (
            <Link className="field-link" href={record.href as Route} key={`${record.type}:${record.recordId}`}>
              <span>{recordTypeLabel(record.type)}</span>
              <strong>{record.label}</strong>
            </Link>
          ))}
        </div>
      ) : null}

      <MeetingPrepAttendeeConfidenceSection attendees={brief.attendeeConfidence} />

      <div className="meeting-prep-section-grid">
        <MeetingPrepSection empty="No person-specific CRM facts are linked to this meeting." items={brief.personFacts} title="Person-Specific Facts" />
        <MeetingPrepSection empty="No organization-specific CRM facts are linked to this meeting." items={brief.organizationFacts} title="Organization Facts" />
        <MeetingPrepSection empty="No active deal context is linked to this meeting." items={brief.dealContext} title="Active Deal Context" />
        <MeetingPrepSection empty="No recent notes or completed activities were found." items={brief.recentHistory} title="Recent History" />
        <MeetingPrepSection empty="No prior reviewed Meeting Intelligence source is linked." items={brief.meetingIntelligence} title="Prior Meeting Intelligence" />
        <MeetingPrepSection empty="No open commitments were found." items={brief.openCommitments} title="Open Commitments" />
        <MeetingPrepSection empty="No active quote status is linked." items={brief.quoteStatus} title="Quote Status" />
        <MeetingPrepSection className="meeting-prep-suggestions" empty="No suggestions are available." items={brief.suggestedTopics} title="Suggested Topics" />
        <MeetingPrepSection className="meeting-prep-missing" empty="No obvious missing context found." items={brief.missingOrUncertain} title="Missing or Uncertain" />
      </div>

      <p className="meeting-prep-footnote">
        Transcript-derived findings remain attributed to their Meeting Intelligence source. This brief does not create notes, activities, associations, quotes, or Relationship Memory updates.
      </p>
    </section>
  );
}

function MeetingPrepSection({
  className,
  empty,
  items,
  title
}: {
  className?: string;
  empty: string;
  items: MeetingPrepBriefItem[];
  title: string;
}) {
  return (
    <section className={["meeting-prep-section", className].filter(Boolean).join(" ")}>
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.source}-${item.label}-${index}`}>
              <strong>{item.label}</strong>
              <span>{item.value}</span>
              <small>
                {item.source}
                {item.sourceRef ? <MeetingPrepSourceRef sourceRef={item.sourceRef} /> : null}
              </small>
              {item.actions && item.actions.length > 0 ? <MeetingPrepActionLinks actions={item.actions} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <InlineEmptyStateText>{empty}</InlineEmptyStateText>
      )}
    </section>
  );
}

function MeetingPrepAttendeeConfidenceSection({ attendees }: { attendees: MeetingPrepAttendeeConfidence[] }) {
  return (
    <section className="meeting-prep-attendee-confidence" aria-labelledby="meeting-prep-attendee-confidence-heading">
      <div className="meeting-prep-section-heading">
        <h3 id="meeting-prep-attendee-confidence-heading">Attendee Confidence</h3>
        <Badge>{attendees.length} signals</Badge>
      </div>
      {attendees.length > 0 ? (
        <ul className="meeting-prep-attendee-list">
          {attendees.map((attendee) => (
            <li className={attendee.internal ? "meeting-prep-attendee meeting-prep-attendee-internal" : "meeting-prep-attendee"} key={attendee.id}>
              <div className="meeting-prep-attendee-main">
                <div>
                  <strong>{attendee.label}</strong>
                  <span>{attendee.detail}</span>
                </div>
                <Badge>{attendee.stateLabel}</Badge>
              </div>
              <div className="meeting-prep-attendee-evidence" aria-label={`${attendee.label} match evidence`}>
                {attendee.evidence.map((evidence, index) => (
                  <small key={`${attendee.id}-evidence-${index}`}>
                    {evidence.label}
                    {evidence.detail ? <span> - {evidence.detail}</span> : null}
                    {evidence.sourceRef ? <MeetingPrepSourceRef sourceRef={evidence.sourceRef} /> : null}
                  </small>
                ))}
              </div>
              {attendee.confirmedLinks.length > 0 ? (
                <div className="meeting-prep-attendee-links" aria-label={`${attendee.label} confirmed CRM links`}>
                  <span>Confirmed</span>
                  <MeetingPrepCandidateLinks candidates={attendee.confirmedLinks} />
                </div>
              ) : null}
              {attendee.suggestedCandidates.length > 0 ? (
                <div className="meeting-prep-attendee-links" aria-label={`${attendee.label} suggested CRM candidates`}>
                  <span>Suggested</span>
                  <MeetingPrepCandidateLinks candidates={attendee.suggestedCandidates} />
                </div>
              ) : null}
              <MeetingPrepActionLinks actions={attendee.actions} />
            </li>
          ))}
        </ul>
      ) : (
        <InlineEmptyStateText>No attendee evidence is available.</InlineEmptyStateText>
      )}
    </section>
  );
}

function MeetingPrepCandidateLinks({ candidates }: { candidates: MeetingPrepAttendeeCandidate[] }) {
  return (
    <>
      {candidates.map((candidate) => (
        <span className="meeting-prep-candidate-link" key={candidate.recordId}>
          <Link className="inline-link" href={candidate.href as Route}>
            {candidate.label}
          </Link>
          {candidate.detail ? <small>{candidate.detail}</small> : null}
        </span>
      ))}
    </>
  );
}

function MeetingPrepActionLinks({ actions }: { actions: MeetingPrepManualAction[] }) {
  return (
    <div className="meeting-prep-action-links">
      {actions.map((action) => (
        <Link className="inline-link" href={action.href as Route} key={`${action.label}:${action.href}`}>
          {action.label}
        </Link>
      ))}
    </div>
  );
}

function MeetingPrepSourceRef({ sourceRef }: { sourceRef: MeetingPrepBriefSourceRef }) {
  return (
    <span className="meeting-prep-source-ref" title={sourceRef.excerpt}>
      {" - "}
      <Link className="inline-link" href={sourceRef.href as Route}>
        {sourceRef.label}
      </Link>
      {sourceRef.occurredAt ? <span> - {sourceRef.occurredAt.slice(0, 10)}</span> : null}
      {sourceRef.detail ? <span> - {sourceRef.detail}</span> : null}
    </span>
  );
}

function formatMeetingTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function recordTypeLabel(type: MeetingPrepBriefSourceRef["type"]) {
  if (type === "person") return "Contact";
  if (type === "organization") return "Organization";
  if (type === "deal") return "Deal";
  if (type === "quote") return "Quote";
  if (type === "meeting_intelligence") return "Meeting Intelligence";
  if (type === "note") return "Note";
  return "Activity";
}
