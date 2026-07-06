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

- scanned or image-only PDF: tries local text extraction first, then queues OCR or vision extraction when a PDF-capable `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` is configured; otherwise fails with a clear provider-not-configured state
- corrupt, encrypted, or unreadable PDF/DOCX: clear extraction failure
- `.pptx`: unsupported in this slice because there is no direct local presentation parser; export to PDF, DOCX, markdown, HTML, or text first
- `.xlsx`: unsupported in this slice because there is no direct local spreadsheet parser; export to CSV, markdown, HTML, or text first
- legacy `.doc`: unsupported; convert to `.docx` first
- image/whiteboard: queues OCR or vision extraction when `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` is configured; otherwise fails with a clear provider-not-configured state
- audio: queues transcription when `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` is configured; otherwise fails with a clear provider-not-configured state
- video: queues transcription or media-processing extraction when `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` is configured; otherwise fails with a clear provider-not-configured state
- unknown files: unsupported with a clear failure message

The current app accepts uploaded PDF/DOCX bytes and text-style artifact content for synchronous extraction. Provider-backed image, scanned-PDF, audio, and video bytes are written to private Meeting Intelligence file storage before a background job is queued, and the job stores a storage reference instead of embedding the original base64 payload. Meeting Intelligence stores extracted text, markdown, proposal JSON, and temporary provider-upload metadata; it is not a user-facing document store and deletes successfully extracted provider files after the worker reads them.

## Data Model

`MeetingIntake` stores:

- workspace and creator
- source type and original file metadata
- user context
- raw text and normalized markdown
- status
- analysis/proposal JSON, including processor status metadata for detected source type, original filename, extraction method, local/provider-required conversion mode, required provider when applicable, temporary stored-file metadata for queued provider extraction, failure code, and extraction warnings
- apply-result JSON
- failure message and applied timestamp

Statuses are `DRAFT`, `EXTRACTING`, `EXTRACTED`, `ANALYZING`, `READY_FOR_REVIEW`, `APPLIED`, and `FAILED`.

## Matching And Proposals

Matching is deterministic and workspace-scoped. It checks manual hints, email addresses, contact names, organization names/domains, deal titles, lead titles, and related names. Ambiguous or unmatched entities are warnings, not automatic creation.

The review page groups matched deals, leads, organizations, contacts, ambiguous matches, and unmatched mentions. Each match and proposal carries concise evidence, confidence, and matched-reason metadata where deterministic analysis can provide it.

Proposals can include:

- completed meeting activity
- notes for matched people, organizations, deals, and leads
- personal/company/deal/lead fact notes when detected
- review-first Relationship Brief updates for matched contacts when explicit relationship context is detected
- next-step activities from action-item-like lines
- warnings for ambiguity, unmatched entities, locked lifecycle states, and missing due dates

Noteworthy contact/person facts can become curated Relationship Brief updates when they fit the existing contact profile fields, and can also be proposed as contact notes when they are better retained as raw timeline memory. Organization/company facts are proposed as organization notes rather than forcing an organization-level Relationship Brief schema. Deal-specific facts are proposed as deal notes or meeting context, and lead-specific facts are proposed as lead notes when the lead is still valid for updates. The review UI labels these destinations separately so users can distinguish curated contact memory from raw contact, company, deal, lead, meeting-log, and follow-up proposals before apply.

Relationship Brief proposals are deterministic by default. If `MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER=openai` and `OPENAI_API_KEY` are configured, a provider-backed semantic extractor can enrich matched-contact proposals with richer relationship facts, provider attribution, evidence, sensitivity guidance, warnings, and an existing-plus-proposed merge preview. Provider output is validated back to known matched contacts and protected-trait fields are dropped before review. If the provider is missing or fails, deterministic proposals remain available.

Relationship Brief review breaks each field proposal into individual facts for review while preserving older field-level proposal JSON. The review UI treats these as Contact Relationship Memory updates, separate from normal contact, organization, deal, and lead notes. Each target field shows usage/safety badges, Existing, Proposed facts, and After apply views. Users can include or reject each fact, edit the fact text, or move it to a different Relationship Brief field before apply. Likely duplicates already present in the selected contact's current Relationship Brief default to excluded and are not appended again; date-like or event-like facts show staleness warnings so users can decide whether curated profile memory is appropriate. If the reviewer retargets a Relationship Brief proposal to a different contact, the UI reloads that contact through the existing workspace-scoped people route, clears stale original-contact preview context while loading, recalculates duplicate and staleness guidance, refreshes After apply, and blocks apply if the selected contact brief cannot be loaded.

When approved Relationship Brief facts change a contact profile, Meeting Intelligence stores a concise field-level change summary in the existing `person.updated` audit metadata rather than creating a separate history model. The applied-intake result and contact Relationship Brief panel show curated previous/new excerpts, field labels, accepted-fact counts, Meeting Intelligence intake title/date when available, timestamp, and actor. This is a review aid, not a raw memory log: unchanged fields are omitted and opening history never mutates CRM data.

Users can include/exclude each proposed meeting log, note, Relationship Brief update, and follow-up; edit note bodies, relationship facts, and activity titles/details/dates; manually reassign proposal targets to known CRM records; or clear a target so an included item is skipped instead of written to an uncertain record. Submitted target ids are validated in the current workspace before apply. Cross-workspace, deleted, closed-deal, converted-lead, and missing targets are skipped with clear reasons.

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

Text, markdown, RTF, HTML, CSV, JSON, text-based PDF, and DOCX process synchronously with bounded local extraction. Images, scanned/image-only PDFs, audio, and provider-capable video use the existing background job foundation when the provider-neutral HTTP adapter is configured:

- `meeting_intake.extract_media`

Configure `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` to enable image/scanned PDF OCR and audio/video transcription. Set optional `MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN` to send a bearer token. New provider-backed jobs contain `sourceType` (`image`, `pdf`, `audio`, or `video`), `filename`, `mimeType`, workspace/intake ids, and a `storedFile` reference with backend, key, byte length, checksum, created/expiry timestamps, and source metadata. The worker reads the stored bytes, verifies metadata/checksum/expiry, then calls the provider with JSON containing `sourceType`, `filename`, `mimeType`, and `fileBase64`. Providers should return JSON with `text`, `transcript`, or `markdown` plus optional `warnings`, `confidence`, and `metadata`.

Storage is selected with `MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND`. The default `local-filesystem` backend is configured with `MEETING_INTELLIGENCE_FILE_STORAGE_DIR`, `MEETING_INTELLIGENCE_FILE_STORAGE_MAX_MB`, and `MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS`; it is suitable for local/dev or a single deployment where the web and worker share the same private persistent volume. The `s3-compatible` backend uses `MEETING_INTELLIGENCE_S3_ENDPOINT`, `MEETING_INTELLIGENCE_S3_REGION`, `MEETING_INTELLIGENCE_S3_BUCKET`, `MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID`, `MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY`, and optional `MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE` to write the same `content.bin` and `metadata.json` object pair to a private S3/R2-compatible bucket. Object keys are generated from workspace/intake ids plus a UUID, never from filenames or secrets.

The `s3-compatible` backend supports direct-to-object-storage upload for provider-backed files in two modes. Single-object direct upload uses `POST /api/v1/workspaces/:workspaceId/meeting-intake-upload-sessions` to create a `DRAFT` intake, write cleanup-visible stored-file metadata, return a short-lived signed `PUT` URL, and finalize through `POST /api/v1/workspaces/:workspaceId/meeting-intake-upload-sessions/:uploadSessionId/finalize`. Multipart upload uses `POST /api/v1/workspaces/:workspaceId/meeting-intake-multipart-upload-sessions` to start a private S3/R2 multipart upload for a generated stored-file key, `GET .../:uploadSessionId` to inspect safe reload-recovery status, `POST .../:uploadSessionId/parts` to sign specific part numbers, `POST .../:uploadSessionId/complete` to complete the object from validated ETags, and `POST .../:uploadSessionId/abort` to abort an incomplete session. The browser computes SHA-256 before either path and the completion step reads the final object through the same stored-file abstraction used by the worker. Missing, expired, wrong-backend, wrong-workspace, wrong-intake, wrong-source, wrong-size, and checksum-mismatched content fail before `meeting_intake.extract_media` is queued; size and checksum mismatches return distinct error codes.

Both upload modes keep app/job payloads small. Session responses never return credentials, local paths, stored-file refs, bucket names, object keys, filenames, payloads, or bytes, except that signed S3/R2 URLs necessarily contain provider-required signed query parameters and object path information. After completion, the queued job contains `storedFile`, not `fileBase64`, and the queue path keeps a per-intake dedupe key. Repeating direct finalize after queueing returns `409 MEETING_INTAKE_DIRECT_UPLOAD_INVALID_STATE`; repeating multipart completion or completing after abort returns `409 MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE`. Neither path can create duplicate provider extraction jobs.

The browser uses capability discovery to choose the safest path for provider-backed candidates: image/whiteboard, audio, video, and large PDF artifacts that may require OCR. Single-object direct upload is used up to the advertised direct-upload max; multipart is used above that threshold when the S3/R2 backend and provider support it. Multipart uploads are sequential and resumable across page reloads. The form stores one safe local resume record per workspace with upload session id, workspace id, source type, file label, MIME type, byte length, SHA-256, part size/count, uploaded part ETags, and retention expiry. It does not store file bytes, signed URLs, credentials, provider tokens, object keys, local paths, stored-file refs, CRM context text, or hints. After reload, the form inspects the draft session, reconciles uploaded parts with S3/R2 ListParts, asks the user to choose the same file, verifies the checksum, then continues from the next missing part. If the server reports that the session is already queued, expired, aborted, or missing, local resume state is cleared and no duplicate job is created. User-visible cancel calls the abort route; failed abort keeps the local resume record so the user can retry or wait for retention cleanup. Durable multiple-upload queues, parallel part upload, and opaque server-side session ids that hide object path details inside signed URLs remain deferred. S3/R2 buckets used from the browser must allow the relevant `PUT` CORS flow and expose the `ETag` response header for multipart completion.

Smaller PDFs and DOCX files keep the existing local extraction path, and text/markdown/RTF/HTML/CSV/JSON files still send extracted text rather than binary bytes. The form surfaces hashing, session creation, raw upload or part upload, safe single-object retry, finalization/completion, queued, fallback, already-finalized, aborting, and failed states. If the upload session route reports local filesystem storage, missing provider config, unsupported provider source type, unavailable direct/multipart upload, or another safe fallback condition, the form keeps the existing bounded base64 intake path where the file is within the advertised app-upload limit.

`GET /api/v1/workspaces/:workspaceId/meeting-intake-upload-capabilities` is the preflight policy endpoint for the browser. It returns only safe workspace/environment upload facts: storage backend category, private/retention posture, direct-upload availability and size limits, multipart availability, source types, part size, max parts, max bytes, abort support, cleanup behavior, bounded app-upload limits, local extraction source types and binary/text caps, provider support by source type, unsupported source reasons, and guidance strings. It intentionally omits credentials, provider URLs/tokens, bucket names, signed URLs, local paths, object keys, stored-file refs, filenames, and payloads. Local filesystem storage reports multipart unsupported; S3/R2 reports multipart supported only when the provider is configured and supports the source type.

Northstar also includes an internal provider-compatible route at `/api/internal/meeting-intelligence/media-extract`. Configure `MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL` to the app's absolute internal route URL, set `MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN` to a shared bearer token, set `MEETING_INTELLIGENCE_MEDIA_PROVIDER=openai`, and set `OPENAI_API_KEY` to enable the first-party OpenAI adapter. The internal route uses OpenAI vision for image/whiteboard extraction and OpenAI audio transcription for audio files. Scanned PDFs and video remain explicitly unsupported by this OpenAI route until safe PDF OCR and video audio-extraction paths, or a provider capable of those source types, are added.

Provider-backed processors update the intake from `EXTRACTING` to `READY_FOR_REVIEW` after successful markdown normalization, matching, and proposal generation, then delete the stored provider file. Provider failures are stored on the intake and left retryable through the job queue until the job reaches its configured max attempts, keeping the stored file available until success or retention cleanup. Missing, invalid, or expired stored files fail the intake clearly and the provider is not called. Provider-not-configured cases fail clearly and do not create fake markdown or CRM proposals.

Semantic Relationship Brief extraction is separate from media extraction. Configure `MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER=openai` plus `OPENAI_API_KEY` to enable OpenAI-backed relationship extraction during analysis. `MEETING_INTELLIGENCE_OPENAI_RELATIONSHIP_MODEL` can override the default model. This provider receives normalized markdown, optional user context, and only workspace-scoped matched contact candidates; it does not write to CRM directly.

The default `deterministicMeetingAnalysisProvider` implements the `MeetingAnalysisProvider` contract with `analyzeMeetingMarkdown(input)`. Future AI providers should return structured review data with summary, evidence, warnings, confidence, entity candidates, proposed notes, and proposed next steps, but provider output must still be validated and reviewed before any CRM write.

Contextual launch links from individual deal, organization, contact, lead, and activity pages are intentionally deferred for a later focused UX slice. The safe pattern is to prefill context and hint ids only; launch points must not create records or apply proposals automatically.
