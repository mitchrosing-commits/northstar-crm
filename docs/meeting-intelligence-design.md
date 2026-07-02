# Meeting Intelligence / File-to-CRM Intake

Meeting Intelligence turns meeting artifacts into reviewable CRM updates. It is intentionally a CRM workflow, not a document-management, transcription, video, WMS/OMS, project-management, ticketing, or e-signature product.

## Review-First Rule

Automated analysis never silently mutates CRM data. The workflow is:

1. Create a persisted `MeetingIntake`.
2. Detect the source type.
3. Extract supported local text.
4. Normalize the text into markdown.
5. Match existing CRM objects in the current workspace.
6. Generate deterministic proposed updates.
7. Let the user edit/select the proposals.
8. Apply only approved notes and activities through existing services.

## Supported Sources

Supported now:

- pasted text
- markdown
- `.txt` and `.md` text files
- text-based PDF files via local `pdfjs-dist` extraction
- `.docx` Word files via local `mammoth` extraction

Detected but deferred/provider-required:

- scanned or image-only PDF: requires OCR or vision provider integration
- corrupt, encrypted, or unreadable PDF/DOCX: clear extraction failure
- legacy `.doc`: unsupported; convert to `.docx` first
- image/whiteboard: requires OCR or vision provider integration
- audio: requires transcription provider integration
- video: requires transcription or media-processing provider integration
- unknown files: unsupported with a clear failure message

The current app accepts uploaded PDF/DOCX bytes for synchronous extraction, then stores extracted text and markdown, not original binary files.

## Data Model

`MeetingIntake` stores:

- workspace and creator
- source type and original file metadata
- user context
- raw text and normalized markdown
- status
- analysis/proposal JSON
- apply-result JSON
- failure message and applied timestamp

Statuses are `DRAFT`, `EXTRACTING`, `EXTRACTED`, `ANALYZING`, `READY_FOR_REVIEW`, `APPLIED`, and `FAILED`.

## Matching And Proposals

Matching is deterministic and workspace-scoped. It checks manual hints, email addresses, contact names, organization names/domains, deal titles, lead titles, and related names. Ambiguous or unmatched entities are warnings, not automatic creation.

The review page groups matched deals, leads, organizations, contacts, ambiguous matches, and unmatched mentions. Each match and proposal carries concise evidence, confidence, and matched-reason metadata where deterministic analysis can provide it.

Proposals can include:

- completed meeting activity
- notes for matched people, organizations, deals, and leads
- personal/company/deal fact notes when detected
- next-step activities from action-item-like lines
- warnings for ambiguity, unmatched entities, locked lifecycle states, and missing due dates

Users can include/exclude each proposed meeting log, note, and follow-up; edit note bodies and activity titles/details/dates; manually reassign proposal targets to known CRM records; or clear a target so an included item is skipped instead of written to an uncertain record. Submitted target ids are validated in the current workspace before apply. Cross-workspace, deleted, closed-deal, converted-lead, and missing targets are skipped with clear reasons.

## Apply Behavior

Apply uses existing note and activity services. That preserves:

- workspace access checks
- same-workspace record validation
- closed-deal note/activity locks
- converted-lead note/activity locks
- completed-activity behavior
- audit logs for created notes and activities

Reapplying an already-applied intake returns the stored result and does not duplicate CRM updates.

## Future Provider / Job Boundary

Text, markdown, text-based PDF, and DOCX process synchronously with bounded local extraction. Future heavy processors should use the existing background job foundation once provider integrations exist:

- `meeting_intake.extract`
- `meeting_intake.analyze`

Provider-backed processors should update intake status, store clear errors, and keep the same review-first apply contract.

The default `deterministicMeetingAnalysisProvider` implements the `MeetingAnalysisProvider` contract with `analyzeMeetingMarkdown(input)`. Future AI providers should return structured review data with summary, evidence, warnings, confidence, entity candidates, proposed notes, and proposed next steps, but provider output must still be validated and reviewed before any CRM write.

Contextual launch links from individual deal, organization, contact, lead, and activity pages are intentionally deferred for a later focused UX slice. The safe pattern is to prefill context and hint ids only; launch points must not create records or apply proposals automatically.
