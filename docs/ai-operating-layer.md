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

The first shared foundation lives in `lib/services/northstar-ai-service.ts`.

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
- Add assistant adapters to Lead, Organization, Meeting Intelligence review, Settings diagnostics, and developer/admin diagnostics pages.
- Expand discrepancy detectors for duplicate contacts, stale Gmail connection rows, meeting fact retargeting, and email sender CRM matching.
- Add audit events only when a user accepts or applies an assistant-proposed change through a normal service mutation.
