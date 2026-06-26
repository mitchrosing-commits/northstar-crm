import { formatDate } from "@/components/format";
import { NoteDeleteButton } from "@/components/note-delete-button";
import { NoteForm } from "@/components/note-form";

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
  emptyMessage: string;
  lockedMessage?: string;
  notes: Note[];
  showForm?: boolean;
  topMargin?: boolean;
  workspaceId: string;
};

export function NotesPanel({
  attachment,
  emptyMessage,
  lockedMessage,
  notes,
  showForm = true,
  topMargin = true,
  workspaceId
}: NotesPanelProps) {
  const lockedCopy = lockedMessage ?? "Notes are locked for this record.";
  const sortedNotes = [...notes].sort((a, b) => noteTime(b) - noteTime(a));

  return (
    <section className="data-card notes-panel" style={{ marginTop: topMargin ? 14 : undefined }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Recent Notes</h2>
        <span className="count-badge">{notes.length}</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 14 }}>
        Plain-text internal notes for this record.
      </p>
      {showForm ? <NoteForm attachment={attachment} workspaceId={workspaceId} /> : <p className="empty-copy">{lockedCopy}</p>}
      {sortedNotes.length > 0 ? (
        <ul className="activity-list" style={{ marginTop: 16 }}>
          {sortedNotes.map((note) => {
            const authorName = note.author?.name ?? note.author?.email ?? "Unknown";
            return (
              <li className="activity-item" key={note.id}>
                <span className="activity-icon" aria-hidden="true">
                  {authorName.slice(0, 1)}
                </span>
                <div>
                  <strong>{authorName}</strong>
                  <div className="deal-meta">
                    <span>{formatDate(note.createdAt)}</span>
                  </div>
                  <p className="muted">{note.body}</p>
                  <div className="activity-actions">
                    <NoteDeleteButton noteId={note.id} workspaceId={workspaceId} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-copy" style={{ marginTop: showForm ? 16 : undefined }}>
          {emptyMessage}
        </p>
      )}
    </section>
  );
}

function noteTime(note: Note) {
  const time = new Date(note.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}
