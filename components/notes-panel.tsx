import { ActionGroup } from "@/components/action-group";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { formatDate } from "@/components/format";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { NoteDeleteButton } from "@/components/note-delete-button";
import { NoteForm } from "@/components/note-form";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TimelineMetaRow } from "@/components/timeline-meta-row";

type NoteAttachment =
  | { dealId: string }
  | { leadId: string }
  | { personId: string }
  | { organizationId: string };

type Note = {
  id: string;
  body: string;
  createdAt: Date | string;
  author?: { name: string | null; email: string } | null;
};

type NotesPanelProps = {
  attachment: NoteAttachment;
  description?: string;
  emptyMessage: string;
  id?: string;
  lockedMessage?: string;
  notes: Note[];
  showDeleteActions?: boolean;
  showForm?: boolean;
  topMargin?: boolean;
  workspaceId: string;
};

const NOTE_PREVIEW_CHARACTER_LIMIT = 420;
const NOTE_PREVIEW_LINE_LIMIT = 8;

export function NotesPanel({
  attachment,
  description = "Plain-text internal notes for this record.",
  emptyMessage,
  id = "notes",
  lockedMessage,
  notes,
  showDeleteActions = true,
  showForm = true,
  topMargin = true,
  workspaceId
}: NotesPanelProps) {
  const lockedCopy = lockedMessage ?? "Notes are locked for this record.";
  const panelClassName = topMargin ? "data-card notes-panel section-spaced" : "data-card notes-panel";
  const sortedNotes = [...notes].sort((a, b) => noteTime(b) - noteTime(a));
  const notesCountLabel = `${notes.length} recent ${notes.length === 1 ? "note" : "notes"}`;

  return (
    <section className={panelClassName} id={id}>
      <PanelTitleRow
        actions={
          <CountBadge label={notesCountLabel}>
            {notes.length}
          </CountBadge>
        }
        actionsLabel="Recent notes count"
        description={description}
        title="Recent Notes"
      />
      {showForm ? <NoteForm attachment={attachment} workspaceId={workspaceId} /> : <LockedPanelNotice>{lockedCopy}</LockedPanelNotice>}
      {sortedNotes.length > 0 ? (
        <ul className="activity-list notes-panel-list">
          {sortedNotes.map((note) => {
            const authorName = note.author?.name ?? note.author?.email ?? "Unknown";
            const noteDate = formatDate(note.createdAt);
            const noteActionsLabel = `Note by ${authorName} from ${noteDate} actions`;
            const preview = notePreview(note.body);
            return (
              <li className="activity-item note-item" key={note.id}>
                <span className="activity-icon" aria-hidden="true">
                  {authorName.slice(0, 1)}
                </span>
                <div>
                  <strong>{authorName}</strong>
                  <TimelineMetaRow
                    ariaLabel={`Note by ${authorName} metadata`}
                    className="notes-panel-meta"
                    items={["Internal note", noteDate]}
                  />
                  {preview.isTruncated ? (
                    <div className="note-body note-body-preview">
                      <p>{preview.text}</p>
                      <details className="note-body-details">
                        <summary>Show full note</summary>
                        <p>{note.body}</p>
                      </details>
                    </div>
                  ) : (
                    <p className="note-body">{note.body}</p>
                  )}
                  {showDeleteActions ? (
                    <ActionGroup className="activity-actions" label={noteActionsLabel}>
                      <NoteDeleteButton
                        ariaLabel={`Remove note by ${authorName} from ${noteDate}`}
                        noteId={note.id}
                        workspaceId={workspaceId}
                      />
                    </ActionGroup>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          className={showForm ? "empty-state-compact empty-state-panel notes-panel-empty" : "empty-state-compact empty-state-panel"}
          title={emptyMessage}
        />
      )}
    </section>
  );
}

function noteTime(note: Note) {
  const time = new Date(note.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function notePreview(body: string) {
  const lines = body.split(/\r?\n/);
  const lineLimited = lines.length > NOTE_PREVIEW_LINE_LIMIT;
  const firstLines = lineLimited ? lines.slice(0, NOTE_PREVIEW_LINE_LIMIT).join("\n") : body;
  const characterLimited = firstLines.length > NOTE_PREVIEW_CHARACTER_LIMIT;
  const text = characterLimited ? firstLines.slice(0, NOTE_PREVIEW_CHARACTER_LIMIT).trimEnd() : firstLines.trimEnd();

  return {
    isTruncated: lineLimited || characterLimited || text.length < body.trimEnd().length,
    text: `${text}${lineLimited || characterLimited || text.length < body.trimEnd().length ? "..." : ""}`
  };
}
