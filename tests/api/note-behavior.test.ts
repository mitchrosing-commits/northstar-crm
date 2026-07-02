import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const service = [
  readFileSync(join(process.cwd(), "lib/services/note-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");
const detailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const contactDetailPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationDetailPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const leadDetailPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const noteForm = readFileSync(join(process.cwd(), "components/note-form.tsx"), "utf8");
const notesPanel = readFileSync(join(process.cwd(), "components/notes-panel.tsx"), "utf8");
const recordHeaderActions = readFileSync(join(process.cwd(), "components/record-header-actions.tsx"), "utf8");
const panelTitleRow = readFileSync(join(process.cwd(), "components/panel-title-row.tsx"), "utf8");
const recordPanelJumpNav = readFileSync(join(process.cwd(), "components/record-panel-jump-nav.tsx"), "utf8");
const timelineMetaRow = readFileSync(join(process.cwd(), "components/timeline-meta-row.tsx"), "utf8");
const noteDeleteButton = readFileSync(join(process.cwd(), "components/note-delete-button.tsx"), "utf8");
const searchPage = readFileSync(join(process.cwd(), "app/search/page.tsx"), "utf8");
const searchService = readFileSync(join(process.cwd(), "lib/services/search-service.ts"), "utf8");

describe("deal note creation behavior", () => {
  it("routes note creation through a validated workspace API payload", () => {
    expect(route).toContain("createNoteSchema.parse");
    expect(route).toContain("createNote(actor");
    expect(route).toContain("softDeleteNote(actor");
  });

  it("keeps note creation workspace-scoped and audited", () => {
    expect(service).toContain("assertNoteLinks");
    expect(service).toContain("assertOpenDealInWorkspace");
    expect(service).toContain("Closed deals cannot be edited.");
    expect(service).toContain("assertRecordInWorkspace(\"person\"");
    expect(service).toContain("assertRecordInWorkspace(\"organization\"");
    expect(service).toContain("noteAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("Attach the note to a CRM record.");
    expect(service).toContain("const input = objectInput(data)");
    expect(service).toContain("Add new context on the converted deal.");
    expect(service).toContain("normalizeRequiredNoteBody(input.body)");
    expect(service).toContain("normalizeOptionalNoteId(input.dealId)");
    expect(service).toContain("Note attachment ids must be text.");
    expect(service).toContain("Note body is required.");
    expect(service).toContain("assertNoteDeletable(actor.workspaceId, noteId)");
    expect(service).toContain("Converted lead notes cannot be removed.");
    expect(service).toContain("writeAuditLog(actor, \"note.created\"");
    expect(service).toContain("writeAuditLog(actor, \"note.deleted\"");
  });

  it("adds notes from the deal detail page and keeps seeded notes visible", () => {
    expect(detailPage).toContain("NotesPanel");
    expect(detailPage).toContain("notes={deal.notes}");
    expect(detailPage.indexOf("NotesPanel")).toBeLessThan(detailPage.indexOf("RecordTimeline"));
    expect(notesPanel).toContain("NoteForm");
    expect(notesPanel).toContain("EmptyState");
    expect(notesPanel).toContain("PanelTitleRow");
    expect(notesPanel).toContain("const notesCountLabel = `${notes.length} recent ${notes.length === 1 ? \"note\" : \"notes\"}`");
    expect(notesPanel).toContain("aria-label={notesCountLabel}");
    expect(notesPanel).toContain("title={notesCountLabel}");
    expect(notesPanel).toContain("actionsLabel=\"Recent notes count\"");
    expect(notesPanel).toContain("description={description}");
    expect(notesPanel).toContain("Recent Notes");
    expect(notesPanel).toContain("Plain-text internal notes for this record.");
    expect(notesPanel).toContain("id = \"notes\"");
    expect(notesPanel).toContain("id={id}");
    expect(notesPanel).toContain("topMargin ? \"data-card notes-panel section-spaced\" : \"data-card notes-panel\"");
    expect(notesPanel).toContain("className={panelClassName}");
    expect(notesPanel).not.toContain("notes-panel-intro");
    expect(notesPanel).toContain("notes-panel-list");
    expect(notesPanel).toContain("notes-panel-empty");
    expect(notesPanel).toContain("empty-state-compact empty-state-panel notes-panel-empty");
    expect(notesPanel).toContain("count-badge");
    expect(panelTitleRow).toContain("panel-title-row");
    expect(notesPanel).toContain("sortedNotes");
    expect(notesPanel).toContain("noteTime(b) - noteTime(a)");
    expect(notesPanel).toContain("Number.isFinite(time) ? time : 0");
    expect(notesPanel).toContain("sortedNotes.map");
    expect(notesPanel).toContain("formatDate(note.createdAt)");
    expect(notesPanel).toContain("TimelineMetaRow");
    expect(notesPanel).toContain("import { ActionGroup }");
    expect(notesPanel).toContain("className=\"notes-panel-meta\"");
    expect(notesPanel).toContain("ariaLabel={`Note by ${authorName} metadata`}");
    expect(notesPanel).toContain("items={[\"Internal note\", noteDate]}");
    expect(notesPanel).toContain("const noteActionsLabel = `Note by ${authorName} from ${noteDate} actions`");
    expect(notesPanel).toContain('<ActionGroup className="activity-actions" label={noteActionsLabel}>');
    expect(timelineMetaRow).toContain("timeline-meta");
    expect(detailPage).toContain("No notes have been added to this deal.");
    expect(detailPage).toContain("RecordPanelJumpNav");
    expect(recordPanelJumpNav).toContain("href: \"#notes\" as Route");
    expect(recordHeaderActions).toContain("noteHref");
    expect(recordHeaderActions).toContain("noteLabel = \"Add note\"");
    expect(recordHeaderActions).toContain("noteHref && locked");
    expect(recordHeaderActions).toContain("noteLockedLabel = \"Notes locked\"");
    expect(detailPage).toContain("noteHref={\"#notes\" as Route}");
    expect(detailPage).toContain("lockedLabel={closedDealLockedLabel}");
    expect(detailPage).toContain('lockedMessage={closedDealLockMessage("notes")}');
    expect(detailPage).toContain("showDeleteActions={deal.status === \"OPEN\"}");
    expect(detailPage).toContain("showForm={deal.status === \"OPEN\"}");
  });

  it("submits deal notes through the workspace notes API", () => {
    expect(noteForm).toContain("/api/v1/workspaces/${workspaceId}/notes");
    expect(noteForm).toContain("NoteAttachment");
    expect(noteForm).toContain("Internal note");
    expect(noteForm).toContain("Add a plain-text note for your team.");
    expect(noteForm).toContain("disabledHint=\"Write a note before saving.\"");
    expect(noteForm).toContain("Save note");
    expect(noteForm).toContain("dealId");
    expect(noteForm).toContain("leadId");
    expect(noteForm).toContain("personId");
    expect(noteForm).toContain("organizationId");
    expect(noteForm).toContain("body: body.trim()");
  });

  it("adds soft-delete actions for notes in shared note panels", () => {
    expect(notesPanel).toContain("NoteDeleteButton");
    expect(notesPanel).toContain("const noteDate = formatDate(note.createdAt)");
    expect(notesPanel).toContain("items={[\"Internal note\", noteDate]}");
    expect(notesPanel).toContain("ariaLabel={`Remove note by ${authorName} from ${noteDate}`}");
    expect(notesPanel).toContain("showDeleteActions = true");
    expect(notesPanel).toContain("showDeleteActions ? (");
    expect(noteDeleteButton).toContain("ariaLabel?: string");
    expect(noteDeleteButton).toContain("aria-label={ariaLabel}");
    expect(noteDeleteButton).toContain("title={ariaLabel}");
    expect(noteDeleteButton).toContain("method: \"DELETE\"");
    expect(noteDeleteButton).toContain("/api/v1/workspaces/${workspaceId}/notes/${noteId}");
    expect(noteDeleteButton).toContain("router.refresh()");
    expect(route).toContain("resource === \"notes\" && idOrNested && !nestedResource");
  });

  it("adds notes from contact, organization, and unconverted lead detail pages", () => {
    expect(contactDetailPage).toContain("NotesPanel");
    expect(contactDetailPage).toContain("noteHref={\"#notes\" as Route}");
    expect(contactDetailPage).toContain("attachment={{ personId: person.id }}");
    expect(contactDetailPage).toContain("notes={person.notes}");
    expect(contactDetailPage).toContain("RecordPanelJumpNav");
    expect(organizationDetailPage).toContain("NotesPanel");
    expect(organizationDetailPage).toContain("noteHref={\"#notes\" as Route}");
    expect(organizationDetailPage).toContain("attachment={{ organizationId: organization.id }}");
    expect(organizationDetailPage).toContain("notes={organization.notes}");
    expect(organizationDetailPage).toContain("RecordPanelJumpNav");
    expect(leadDetailPage).toContain("NotesPanel");
    expect(leadDetailPage).toContain("noteHref={\"#notes\" as Route}");
    expect(leadDetailPage).toContain("lockedLabel={convertedLeadLockedLabel}");
    expect(leadDetailPage).toContain("attachment={{ leadId: lead.id }}");
    expect(leadDetailPage).toContain("notes={lead.notes}");
    expect(leadDetailPage).toContain("RecordPanelJumpNav");
    expect(leadDetailPage.indexOf("NotesPanel")).toBeLessThan(leadDetailPage.indexOf("RecordTimeline"));
    expect(leadDetailPage).toContain("lead.status === \"CONVERTED\"");
    expect(leadDetailPage).toContain('lockedMessage={convertedLeadLockMessage("notes")}');
    expect(leadDetailPage).toContain("showDeleteActions={lead.status !== \"CONVERTED\"}");
    expect(notesPanel).toContain("NoteForm");
  });

  it("keeps global search indexing notes and linking them to attached records", () => {
    expect(searchService).toContain("prisma.note.findMany");
    expect(searchService).toContain("body: contains");
    expect(searchService).toContain("author: { select: userDisplaySelect }");
    expect(searchPage).toContain("SearchSection id=\"search-notes\" title=\"Notes\"");
    expect(searchPage).toContain("noteTarget(note)");
    expect(searchPage).toContain("attachedLabel(note)");
  });
});
