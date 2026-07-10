import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(join(process.cwd(), "lib/services/meeting-prep-brief-service.ts"), "utf8");
const card = readFileSync(join(process.cwd(), "components/meeting-prep-brief-card.tsx"), "utf8");
const activityPage = readFileSync(join(process.cwd(), "app/activities/[activityId]/edit/page.tsx"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("Meeting Prep Brief v1", () => {
  it("builds a read-only workspace-scoped meeting prep service without CRM mutations", () => {
    expect(service).toContain("export async function buildMeetingPrepBrief");
    expect(service).toContain("export async function buildMeetingPrepBriefForRecord");
    expect(service).toContain("await ensureWorkspaceAccess(actor)");
    expect(service).toContain("workspaceId: actor.workspaceId");
    expect(service).toContain("activityAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("type: ActivityType.MEETING");
    expect(service).toContain("completedAt: null");
    expect(service).toContain("reviewFirst: true");
    expect(service).toContain("workspaceScoped: true");
    expect(service).not.toContain("prisma.note.create");
    expect(service).not.toContain("prisma.activity.create");
    expect(service).not.toContain("prisma.person.update");
    expect(service).not.toContain("prisma.deal.update");
    expect(service).not.toContain("writeAuditLog");
  });

  it("separates stored facts, suggestions, missing context, and attributed Meeting Intelligence sources", () => {
    expect(service).toContain("personFactItems");
    expect(service).toContain("organizationFactItems");
    expect(service).toContain("dealContextItems");
    expect(service).toContain("recentHistoryItems");
    expect(service).toContain("openCommitmentItems");
    expect(service).toContain("quoteItems");
    expect(service).toContain("meetingIntelligenceItems");
    expect(service).toContain("attendeeConfidenceItems");
    expect(service).toContain("MeetingPrepAttendeeState");
    expect(service).toContain("Exact email match");
    expect(service).toContain("Existing Meeting Intelligence association");
    expect(service).toContain("Name-only candidate");
    expect(service).toContain("Workspace member email");
    expect(service).toContain("attendeeManualActions");
    expect(service).toContain('label: "Search organizations"');
    expect(service).toContain('label: "Search deals"');
    expect(service).toContain("missingItems");
    expect(service).toContain("suggestionItems");
    expect(service).toContain('source: "Suggestion"');
    expect(service).toContain('href: `/meeting-intelligence/${intake.id}`');
    expect(service).toContain("parseMeetingDraft");
    expect(service).not.toContain("rawText");
    expect(service).not.toContain("markdownText");
  });

  it("renders a scannable Meeting Prep card with source links and no apply controls", () => {
    expect(card).toContain('aria-label="Meeting prep brief"');
    expect(card).toContain("Person-Specific Facts");
    expect(card).toContain("Attendee Confidence");
    expect(card).toContain("confirmed CRM links");
    expect(card).toContain("suggested CRM candidates");
    expect(card).toContain("MeetingPrepCandidateLinks");
    expect(card).toContain("meeting-prep-candidate-link");
    expect(card).toContain("MeetingPrepActionLinks");
    expect(card).toContain("Organization Facts");
    expect(card).toContain("Active Deal Context");
    expect(card).toContain("Prior Meeting Intelligence");
    expect(card).toContain("Open Commitments");
    expect(card).toContain("Quote Status");
    expect(card).toContain("Suggested Topics");
    expect(card).toContain("Missing or Uncertain");
    expect(card).toContain("MeetingPrepSourceRef");
    expect(card).toContain("This brief does not create notes, activities, associations, quotes, or Relationship Memory updates.");
    expect(card).not.toContain("Apply");
    expect(card).not.toContain("form action");
  });

  it("surfaces the brief from activity, contact, organization, and deal detail pages", () => {
    expect(activityPage).toContain("buildMeetingPrepBrief(actor, activityId)");
    expect(activityPage).toContain("<MeetingPrepBriefCard brief={meetingPrepBrief} />");
    expect(contactPage).toContain('buildMeetingPrepBriefForRecord(actor, { type: "person", id: person.id })');
    expect(organizationPage).toContain('buildMeetingPrepBriefForRecord(actor, { type: "organization", id: organization.id })');
    expect(dealPage).toContain('buildMeetingPrepBriefForRecord(actor, { type: "deal", id: deal.id })');
    expect(contactPage).toContain('href: "#meeting-prep-brief" as Route');
    expect(organizationPage).toContain('href: "#meeting-prep-brief" as Route');
    expect(dealPage).toContain('href: "#meeting-prep-brief" as Route');
    expect(contactPage).toContain("...(meetingPrepBrief");
    expect(organizationPage).toContain("...(meetingPrepBrief");
    expect(dealPage).toContain("...(meetingPrepBrief");
  });

  it("adds responsive Meeting Prep styles without a broad redesign", () => {
    expect(globals).toContain(".meeting-prep-brief-card");
    expect(globals).toContain(".meeting-prep-section-grid");
    expect(globals).toContain(".meeting-prep-attendee-confidence");
    expect(globals).toContain(".meeting-prep-attendee-list");
    expect(globals).toContain(".meeting-prep-action-links");
    expect(globals).toContain("word-break: normal");
    expect(globals).toContain(".meeting-prep-suggestions");
    expect(globals).toContain(".meeting-prep-missing");
    expect(globals).toContain(".meeting-prep-summary-grid");
    expect(globals).toContain(".meeting-prep-linked-records");
    expect(globals).toContain(".meeting-prep-source-ref");
  });
});
