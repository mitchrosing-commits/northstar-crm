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
- `.rtf` rich text files via conservative local formatting flattening
- `.html` and `.htm` exports via conservative local body-to-markdown conversion
- `.csv` action trackers or structured exports via the local CSV parser and markdown table conversion
- `.json` structured meeting exports via local JSON parsing and readable markdown conversion
- text-based PDF files via local `pdfjs-dist` extraction
- `.docx` Word files via local `mammoth` extraction

Detected but deferred/provider-required:

- scanned or image-only PDF: requires OCR or vision provider integration
- corrupt, encrypted, or unreadable PDF/DOCX: clear extraction failure
- `.pptx`: unsupported in this slice because there is no direct local presentation parser; export to PDF, DOCX, markdown, HTML, or text first
- `.xlsx`: unsupported in this slice because there is no direct local spreadsheet parser; export to CSV, markdown, HTML, or text first
- legacy `.doc`: unsupported; convert to `.docx` first
- image/whiteboard: queues OCR or vision extraction when `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` is configured; otherwise fails with a clear provider-not-configured state
- audio: queues transcription when `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` is configured; otherwise fails with a clear provider-not-configured state
- video: queues transcription or media-processing extraction when `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` is configured; otherwise fails with a clear provider-not-configured state
- unknown files: unsupported with a clear failure message

The current app accepts uploaded PDF/DOCX bytes and text-style artifact content for synchronous extraction. Media bytes are stored only in the queued job payload long enough for provider extraction. Meeting Intelligence stores extracted text and markdown, not original binary files.

## Data Model

`MeetingIntake` stores:

- workspace and creator
- source type and original file metadata
- user context
- raw text and normalized markdown
- status
- analysis/proposal JSON, including processor status metadata for detected source type, original filename, extraction method, local/provider-required conversion mode, required provider when applicable, failure code, and extraction warnings
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

Text, markdown, RTF, HTML, CSV, JSON, text-based PDF, and DOCX process synchronously with bounded local extraction. Media files use the existing background job foundation when the provider-neutral HTTP adapter is configured:

- `meeting_intake.extract_media`

Configure `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` to enable image OCR and audio/video transcription. Set optional `MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN` to send a bearer token. The provider receives JSON with `sourceType`, `filename`, `mimeType`, and `fileBase64`, and should return JSON with `text`, `transcript`, or `markdown` plus optional `warnings`, `confidence`, and `metadata`.

Northstar also includes an internal provider-compatible route at `/api/internal/meeting-intelligence/media-extract`. Configure `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` to the app's absolute internal route URL, set `MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN` to a shared bearer token, set `MEETING_INTELLIGENCE_MEDIA_PROVIDER=openai`, and set `OPENAI_API_KEY` to enable the first-party OpenAI adapter. The internal route uses OpenAI vision for image/whiteboard extraction and OpenAI audio transcription for audio files. Video remains explicitly unsupported by this OpenAI route until a safe video audio-extraction/storage path or a video-capable provider is added.

Provider-backed processors update the intake from `EXTRACTING` to `READY_FOR_REVIEW` after successful markdown normalization, matching, and proposal generation. Provider failures are stored on the intake and left retryable through the job queue until the job reaches its configured max attempts. Provider-not-configured cases fail clearly and do not create fake markdown or CRM proposals.

The default `deterministicMeetingAnalysisProvider` implements the `MeetingAnalysisProvider` contract with `analyzeMeetingMarkdown(input)`. Future AI providers should return structured review data with summary, evidence, warnings, confidence, entity candidates, proposed notes, and proposed next steps, but provider output must still be validated and reviewed before any CRM write.

Contextual launch links from individual deal, organization, contact, lead, and activity pages are intentionally deferred for a later focused UX slice. The safe pattern is to prefill context and hint ids only; launch points must not create records or apply proposals automatically.
