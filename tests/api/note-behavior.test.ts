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
    expect(service).toContain("assertRecordInWorkspace(\"deal\"");
    expect(service).toContain("assertRecordInWorkspace(\"person\"");
    expect(service).toContain("assertRecordInWorkspace(\"organization\"");
    expect(service).toContain("Add new context on the converted deal.");
    expect(service).toContain("writeAuditLog(actor, \"note.created\"");
    expect(service).toContain("writeAuditLog(actor, \"note.deleted\"");
  });

  it("adds notes from the deal detail page and keeps seeded notes visible", () => {
    expect(detailPage).toContain("NotesPanel");
    expect(detailPage).toContain("notes={deal.notes}");
    expect(detailPage.indexOf("NotesPanel")).toBeLessThan(detailPage.indexOf("RecordTimeline"));
    expect(notesPanel).toContain("NoteForm");
    expect(notesPanel).toContain("Recent Notes");
    expect(notesPanel).toContain("Plain-text internal notes for this record.");
    expect(notesPanel).toContain("count-badge");
    expect(notesPanel).toContain("sortedNotes");
    expect(notesPanel).toContain("noteTime(b) - noteTime(a)");
    expect(notesPanel).toContain("Number.isFinite(time) ? time : 0");
    expect(notesPanel).toContain("sortedNotes.map");
    expect(notesPanel).toContain("formatDate(note.createdAt)");
    expect(detailPage).toContain("No notes have been added to this deal.");
  });

  it("submits deal notes through the workspace notes API", () => {
    expect(noteForm).toContain("/api/v1/workspaces/${workspaceId}/notes");
    expect(noteForm).toContain("NoteAttachment");
    expect(noteForm).toContain("Internal note");
    expect(noteForm).toContain("Add a plain-text note for your team.");
    expect(noteForm).toContain("Save note");
    expect(noteForm).toContain("dealId");
    expect(noteForm).toContain("leadId");
    expect(noteForm).toContain("personId");
    expect(noteForm).toContain("organizationId");
    expect(noteForm).toContain("body: body.trim()");
  });

  it("adds soft-delete actions for notes in shared note panels", () => {
    expect(notesPanel).toContain("NoteDeleteButton");
    expect(notesPanel).toContain("<NoteDeleteButton noteId={note.id} workspaceId={workspaceId} />");
    expect(noteDeleteButton).toContain("method: \"DELETE\"");
    expect(noteDeleteButton).toContain("/api/v1/workspaces/${workspaceId}/notes/${noteId}");
    expect(noteDeleteButton).toContain("router.refresh()");
    expect(route).toContain("resource === \"notes\" && idOrNested && !nestedResource");
  });

  it("adds notes from contact, organization, and unconverted lead detail pages", () => {
    expect(contactDetailPage).toContain("NotesPanel");
    expect(contactDetailPage).toContain("attachment={{ personId: person.id }}");
    expect(contactDetailPage).toContain("notes={person.notes}");
    expect(organizationDetailPage).toContain("NotesPanel");
    expect(organizationDetailPage).toContain("attachment={{ organizationId: organization.id }}");
    expect(organizationDetailPage).toContain("notes={organization.notes}");
    expect(leadDetailPage).toContain("NotesPanel");
    expect(leadDetailPage).toContain("attachment={{ leadId: lead.id }}");
    expect(leadDetailPage).toContain("notes={lead.notes}");
    expect(leadDetailPage.indexOf("NotesPanel")).toBeLessThan(leadDetailPage.indexOf("RecordTimeline"));
    expect(leadDetailPage).toContain("lead.status === \"CONVERTED\"");
    expect(leadDetailPage).toContain("Add new context on the converted deal.");
    expect(notesPanel).toContain("NoteForm");
  });

  it("keeps global search indexing notes and linking them to attached records", () => {
    expect(searchService).toContain("prisma.note.findMany");
    expect(searchService).toContain("body: contains");
    expect(searchService).toContain("author: { select: userDisplaySelect }");
    expect(searchPage).toContain("SearchSection title=\"Notes\"");
    expect(searchPage).toContain("noteTarget(note)");
    expect(searchPage).toContain("attachedLabel(note)");
  });
});
