# CRM Change Proposals

CRM change proposals are reusable review-first infrastructure for AI-producing systems that want to suggest contact and organization changes without directly mutating CRM records.

## Proposal Types

- `CREATE_PERSON`: create one contact.
- `UPDATE_PERSON`: update supported fields on one existing contact.
- `CREATE_ORGANIZATION`: create one organization.
- `UPDATE_ORGANIZATION`: update supported fields on one existing organization.
- `LINK_PERSON_ORGANIZATION`: link one existing contact to one existing organization.

## Data Model

`CrmChangeProposal` stores workspace-scoped proposals with structured JSON payloads, source attribution, rationale, confidence/evidence metadata, duplicate candidates, conflict info, status, applying user, timestamps, and a workspace-scoped `idempotencyKey`.

Updates and links store a current-record snapshot at proposal creation. Apply compares that snapshot to the current record `updatedAt` and fails stale proposals instead of silently overwriting newer user changes.

## Permission Mapping

Server-side apply uses AI action permissions:

- `create_contact`
- `update_contact`
- `create_organization`
- `update_organization`
- `link_contact_organization`

`never_allow` blocks proposal creation. `suggest_only` allows a proposal to be stored for review but blocks apply. `require_confirmation` allows explicit user apply. Automatic apply is intentionally not supported for CRM change proposals.

## Supported Fields

Contacts support `firstName`, `lastName`, `email`, `phone`, `organizationId`, `ownerId`, and Relationship Memory fields.

Organizations support `name`, `domain`, and `ownerId`.

Custom fields, deals, leads, merge operations, destructive changes, and blanking existing values are deferred.

## Conflict And Duplicate Handling

Creates check strong duplicate signals:

- contact exact email match
- organization exact domain match
- organization name match

Duplicate candidates are stored on the proposal and block apply. They are not merged automatically.

Updates and links fail when the target record changed after proposal creation or became unavailable/deleted.

## Idempotency

Producers should provide a stable idempotency key per source suggestion. If omitted, Northstar derives one from the normalized proposal input. Repeated creation with the same workspace/key returns the existing proposal.

Repeated apply of an already applied proposal returns the applied result without creating duplicate records.

## Producer Contract

Assistant, Meeting Intelligence, or another producer should call `createCrmChangeProposal` with a supported `proposalType`, structured `proposedPayload`, source metadata, rationale, and evidence. Producers must not directly create or update contacts or organizations for AI-generated suggestions.

## Assistant Supported Actions

`/assistant` can turn clear conversational requests into CRM change proposals for:

- creating a contact
- updating supported contact fields
- creating an organization
- updating supported organization fields
- linking one existing contact to one existing organization

Examples include "Create a contact for Jane Doe at Acme", "Add Jane's phone number", "Create an organization for Northwind", and "Link Sarah to Northwind". The Assistant only uses supported schema fields and grounded conversation or CRM context. Unsupported fields, weak evidence, duplicate risks, and ambiguous matches are surfaced as warnings or clarification needs instead of guessed writes.

The Assistant save action opens the reusable CRM Change Proposal review flow. Users can edit supported values before apply. Applied proposals link to the final contact or organization record. Rejected, failed, duplicate-risk, or stale proposals remain auditable and do not mutate records.

Ambiguous entity resolution is conservative: exact record context and identifiers win, workspace-scoped exact matches are preferred, and multiple plausible people or organizations require clarification. The Assistant does not create duplicates merely because matching was uncertain.

## Deferred

This slice does not add transcript extraction, prompt changes, automatic email-based record creation, broad duplicate merge, custom-field redesign, provider sync, workflow automation, or Assistant autonomous apply.

Unsupported Assistant actions remain deferred: contact titles/custom fields, arbitrary generated field names, deal/quote/lead creation or mutation, email sending, Gmail/provider mutation, relationship-memory mutation through this proposal flow, destructive changes, merge operations, and autonomous background scheduling.
