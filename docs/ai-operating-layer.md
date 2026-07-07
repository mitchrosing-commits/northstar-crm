# Northstar AI Operating Layer

Northstar is moving from isolated AI features toward an AI-first CRM operating layer. The operating layer is not a chatbot and is not an autonomous mutation system. It is a shared foundation for context assembly, explanation, discrepancy detection, and review-first action proposals across CRM records, Inbox, Meeting Intelligence, and system diagnostics.

## Existing AI Surfaces

- **Meeting Intelligence** extracts and normalizes meeting/source text, matches CRM objects, proposes notes, activities, relationship memory updates, and follow-up work, and applies only reviewed user selections through existing services.
- **Relationship Memory** stores curated contact profile fields with usage guidance and audit-backed provenance from manual edits or approved Meeting Intelligence updates.
- **AI Email Reply Assistant** builds workspace-scoped email and CRM context, uses OpenAI only when configured, and returns editable reply drafts that are never sent automatically.
- **Smart Email Labels** classify stored emails when OpenAI is configured, save category/signal snapshots, and power the Relationship Inbox queue without creating records automatically.
- **Relationship Inbox** already has deterministic explainers and next-best-action guidance from saved labels, CRM linkage, and durable linked follow-up state.
- **Background jobs and email connection status** provide structured status, retry, stale-worker, and sanitized-error data, but those fragments were not previously assembled into a reusable assistant context.

## Foundation Added

The shared foundation lives across the AI service layer:

- `lib/services/northstar-ai-service.ts`
- `lib/services/ai-preferences-service.ts`
- `lib/services/ai-record-brief-service.ts`
- `lib/services/ai-hygiene-service.ts`
- `lib/services/ai-email-summary-service.ts`
- `lib/meeting-intelligence/placement-explanations.ts`

The Assistant context builders are:

- `buildContactAssistantContext`
- `buildDealAssistantContext`
- `buildLeadAssistantContext`
- `buildOrganizationAssistantContext`
- `buildInboxAssistantContext`
- `buildMeetingIntelligenceProposalAssistantContext`
- `buildSystemDiagnosticAssistantContext`

Each builder starts with `ensureWorkspaceAccess`, gathers bounded workspace-scoped context, and returns a sanitized `NorthstarAssistantContext`. The context intentionally excludes OAuth tokens, refresh tokens, raw provider payloads, job payload internals, client secrets, env values, and unrelated workspace data.

`buildDeterministicInsight` runs the first deterministic discrepancy detectors:

- missing contact organization links
- missing deal customer links
- incomplete lead links
- open or overdue follow-ups
- open work left on closed deals or converted leads
- contact Relationship Memory that appears company/account-level
- unlinked inbound email
- priority email without durable linked follow-up
- unhealthy email connection rows
- failed/dead or stale jobs
- Meeting Intelligence proposal warning summaries

`buildNorthstarAssistantInsight` returns deterministic diagnostics by default. It can optionally call a provider through `createOpenAINorthstarAssistantProvider`, but provider summaries are gated by `OPENAI_API_KEY`, receive only sanitized assistant context, and may only rewrite the explanation/caution text. They do not create or apply CRM changes.

## AI Preferences Console

`/settings/ai` stores per-user, per-workspace `AiPreference` rows. The schema is explicit rather than a generic JSON blob, with a unique `(workspaceId, userId)` boundary and no provider secrets.

Active preferences:

- record summary style
- Assistant detail level
- suggestion level
- diagnostics detail level
- email reply tone default
- stored email summary length
- Relationship Memory usage posture
- Meeting Intelligence note style
- natural-language guidance, sanitized before storage

Active behavior today:

- Assistant findings/actions are trimmed by detail and suggestion preferences.
- Inbox AI reply drafting defaults to the saved reply tone.
- Diagnostics remain sanitized; simple diagnostics hide low-level job/provider evidence.
- Record briefs use record summary style.
- Stored email summary helpers honor disabled, one-sentence, short, and detailed length preferences.

Reserved preferences:

- provider-specific model selection
- automatic full-body email summarization
- background digest cadence
- autonomous cleanup or proposal persistence

## Review-First Action Model

Assistant actions are typed as proposals:

- create note proposal
- move fact proposal
- create activity proposal
- link CRM record proposal
- mark activity complete proposal
- retry sync proposal
- reconnect guidance proposal
- general review action

Every `NorthstarAssistantSuggestedAction` has `reviewFirst: true`. Viewing an insight panel does not write CRM data, send email, retry jobs, reconnect providers, classify email, or apply Meeting Intelligence changes.

## UI Entry Point

`components/northstar-assistant-panel.tsx` renders the first reusable assistant surface. It shows:

- what Northstar looked at
- the deterministic explanation
- findings and evidence
- suggested next actions
- confidence and provider mode
- guardrails and caution copy

The first mounted surfaces are:

- Inbox (`/email`)
- Contact detail
- Deal detail

Compact AI record briefs now appear on:

- Contact detail
- Deal detail
- Lead detail
- Organization detail

The brief gives a small review-first snapshot: health, what changed, missing/stale review focus, next review action, and source basis. It is intentionally compact so record pages stay readable.

Meeting Intelligence review now includes placement explanations in proposal evidence. These explain why a proposed note, follow-up, or Relationship Memory fact appears to belong on a contact, organization, deal, lead, or activity target. They do not apply anything by themselves.

`/settings/ai` also shows CRM hygiene suggestions for duplicate contacts/organizations, likely contact-organization links, stale or closed-deal activity issues, unlinked stored email, relationship-memory placement candidates, and Meeting Intelligence proposals awaiting review.

## Stored Email Summary Boundary

`ai-email-summary-service` prepares future AI email summaries from stored `EmailLog` data only. It does not request Gmail bodies, OAuth scopes, tokens, provider payloads, or sync retries.

When a stored email has no body and no provider snippet, the helper returns `status: "unavailable"` with a clear message. Full-message email summaries remain blocked until full-message sync safely provides durable body text.

## Safety Model

- Workspace scoping is mandatory before context assembly.
- Builders fetch summaries and bounded related rows, not arbitrary workspace dumps.
- Secrets and env values are never exposed; OAuth secrets remain in `EmailConnectionSecret` and are not selected by assistant builders.
- Provider calls are optional and receive sanitized context only.
- AI suggestions never mutate CRM records silently.
- Existing CRM services remain the only mutation path, preserving record locks, converted-lead restrictions, validation, and audit behavior.

## Future Work

- Add explicit user-triggered provider summarization on the panel.
- Persist reviewed assistant proposals if they become durable workflow objects.
- Add a richer Settings/system diagnostics Assistant view.
- Expand discrepancy detectors for email sender CRM matching and safe proposal persistence.
- Add audit events only when a user accepts or applies an assistant-proposed change through a normal service mutation.
