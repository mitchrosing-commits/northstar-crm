# Cross-Entity Saved Views Design

Status: no-migration cross-entity saved views implemented. Runtime saved views now support Deals, Leads, Contacts/People, and Organizations; Activities and Products remain deferred.

## Objective

Cross-entity saved views should answer: "Can a user save and reapply the exact list state they use every day on core CRM lists?"

The goal is to extend the existing lightweight saved-view pattern without introducing a query builder, sharing model, saved reports, dashboards, permissions redesign, or new filtering semantics.

## Current Saved-View Behavior

Deals, Leads, Contacts/People, and Organizations are the saved-view surfaces today.

Current Deals behavior:

- Saved views are workspace-scoped records in `SavedView`.
- `SavedView.recordType` is set to `DEAL`.
- `SavedView.state` stores serialized URL list state as JSON.
- The persisted state includes:
  - `q`
  - `filters`
  - `sortBy`
  - `sortDirection`
  - `pageSize`
- Page number is intentionally excluded so applying a saved view starts from the current list's first page.
- Deals saved views persist/reapply custom field filter state, including `customFieldId`, `customFieldOperator`, and `customFieldValue`.
- Existing saved views without `customFieldOperator` remain backward-compatible because missing operator defaults to exact `equals` behavior.
- Saved views are workspace-wide. There is no per-user ownership, private/shared view distinction, pinning, ordering, permissions model, or role-specific visibility.
- Creating and deleting saved views goes through server actions on `/deals`; the service enforces workspace access and `recordType: "DEAL"`.

Current Leads behavior:

- Lead saved views reuse the same `SavedView` model with `recordType: "LEAD"`.
- Lead saved views persist/reapply `q`, `status`, `source`, `ownerId`, `customFieldId`, `customFieldOperator`, `customFieldValue`, `sortBy`, `sortDirection`, and `pageSize`.
- Page number is intentionally excluded.
- Creating and deleting Lead saved views goes through server actions on `/leads`; the service enforces workspace access and `recordType: "LEAD"`.
- Invalid or stale saved payloads are normalized to safe Lead list defaults.

Current Contacts/People behavior:

- Contact saved views reuse the same `SavedView` model with `recordType: "PERSON"`.
- Contact saved views persist/reapply `q`, `organizationId`, `ownerId`, `customFieldId`, `customFieldOperator`, `customFieldValue`, `sortBy`, `sortDirection`, and `pageSize`.
- Page number is intentionally excluded.
- Creating and deleting Contact saved views goes through server actions on `/contacts`; the service enforces workspace access and `recordType: "PERSON"`.
- Invalid or stale saved payloads are normalized to safe Contact list defaults.

Current Organizations behavior:

- Organization saved views reuse the same `SavedView` model with `recordType: "ORGANIZATION"`.
- Organization saved views persist/reapply `q`, `ownerId`, `customFieldId`, `customFieldOperator`, `customFieldValue`, `sortBy`, `sortDirection`, and `pageSize`.
- Page number is intentionally excluded.
- Creating and deleting Organization saved views goes through server actions on `/organizations`; the service enforces workspace access and `recordType: "ORGANIZATION"`.
- Invalid or stale saved payloads are normalized to safe Organization list defaults.

## Candidate Entities

Implemented candidates:

- Deals.
- Leads.
- Contacts/People.
- Organizations.

Possible later candidate:

- Activities.

Deferred:

- Products, because products currently have no comparable filter/saved-view surface.
- Reports/search, because those are separate operating surfaces with different semantics.

## Current List State By Entity

Deals:

- Search: `q`.
- Filters: `status`, `stageId`, `ownerId`, `personId`, `organizationId`, `customFieldId`, `customFieldOperator`, `customFieldValue`.
- Sorts: `updatedAt`, `createdAt`, `title`, `valueCents`, `expectedCloseAt`.
- Direction: `asc`, `desc`.
- Page size: serialized.
- Page number: excluded.

Leads:

- Search: `q`.
- Filters: `status`, `source`, `ownerId`, `customFieldId`, `customFieldOperator`, `customFieldValue`.
- Sorts: `updatedAt`, `createdAt`, `title`.
- Direction: `asc`, `desc`.
- Page size: serialized.
- Page number: excluded.

Contacts/People:

- Search: `q`.
- Filters: `organizationId`, `ownerId`, `customFieldId`, `customFieldOperator`, `customFieldValue`.
- Sorts: `name`, `createdAt`, `updatedAt`.
- Direction: `asc`, `desc`.
- Page size: serialized.
- Page number: excluded.

Organizations:

- Search: `q`.
- Filters: `ownerId`, `customFieldId`, `customFieldOperator`, `customFieldValue`.
- Sorts: `name`, `createdAt`, `updatedAt`.
- Direction: `asc`, `desc`.
- Page size: serialized.
- Page number: excluded.

Activities:

- Search: none today.
- Filters: `status`, `due`, `ownerId`, `related`.
- Sorts: `dueAt`, `createdAt`, `updatedAt`, `title`.
- Direction: `asc`, `desc`.
- Page size: supported through pagination.
- Page number: should be excluded if saved views are later added.
- Activities do not use custom field filters.

## Data Model Compatibility

The existing `SavedView` model supports the current Deals, Leads, Contacts/People, and Organizations implementation:

- `workspaceId` scopes views to a workspace.
- `recordType` is an entity discriminator.
- `state Json` can hold entity-specific serialized list state.
- `@@index([workspaceId, recordType])` supports listing views by workspace and record type.

The current `SavedViewRecordType` enum includes:

- `DEAL`
- `LEAD`
- `PERSON`
- `ORGANIZATION`

That means Leads, Contacts/People, and Organizations can use the existing model without a migration. Leads, Contacts/People, and Organizations are implemented.

Activities are not currently represented in `SavedViewRecordType`. Adding Activity saved views would require a schema migration to add `ACTIVITY` to the enum, plus a service/UI slice. That should not be bundled into the first cross-entity saved-view runtime slice.

Backward compatibility:

- Existing Deals saved views remain valid.
- Existing Deals saved views without `customFieldOperator` continue to serialize/apply as exact-match filters.
- The service should keep record-type-specific normalization so stale or invalid payload keys are ignored instead of crashing.

No model change is recommended for Leads, Contacts/People, or Organizations.

## MVP Recommendation

The no-migration saved-view MVP is now complete for the entities already represented by `SavedViewRecordType` and backed by URL-normalized list state:

- Deals.
- Leads.
- Contacts/People.
- Organizations.

No additional no-migration saved-view entity remains. Future saved-view work should be a deliberate new slice rather than another small wiring pass.

Defer Activities:

- Activities need an enum migration and have a different filter parser (`related`, `due`, no `q`, no custom fields).
- Activities should follow only after the core CRM record lists share one reliable saved-view abstraction.

## UX Rules

Save current view:

- Each supported list should show the same compact saved-view panel pattern as Deals.
- The save form should serialize the current normalized list state.
- Page number must remain excluded.
- Empty names should be rejected.

Apply saved view:

- Saved views should render as links back to the entity list with serialized query params.
- Applying a saved view should not preserve stale page number.
- Stale fields or invalid payload values should normalize away or fail safely according to the entity's list parser.

Delete saved view:

- Delete should be workspace-scoped and record-type-scoped.
- Deleting a saved view from one entity must not delete same-id or same-name views from another workspace or entity.

Empty states:

- Entity-specific copy should be concise:
  - `No lead views saved yet.`
  - `No contact views saved yet.`
  - `No organization views saved yet.`
- Avoid suggesting sharing/private views until those exist.

Invalid or stale fields:

- If a saved view references a deleted custom field, the list should not crash.
- For current custom field filtering, a stale field id already fails closed to no matches once applied.
- A later cleanup slice can consider showing stale-view guidance, but the MVP should keep behavior simple.

## Implemented Tests And Future Coverage

Implemented tests cover:

- Workspace scoping.
- Record-type/entity scoping.
- Existing Deals saved-view backward compatibility.
- Leads saved-view create/apply/delete behavior.
- Contacts saved-view create/apply/delete behavior.
- Organizations saved-view create/apply/delete behavior.
- Page number exclusion.
- `customFieldOperator` persistence.
- Existing saved views without `customFieldOperator`.
- Invalid saved payload shape normalizes to safe defaults.
- Invalid filter keys are ignored for the target entity.

Future tests should cover:

- Stale custom field ids do not crash in visible list flows.
- Activities are not exposed until the enum/schema intentionally supports them.

Browser smoke should stay light: add one stable assertion for a saved-view panel on a newly supported list only after runtime support exists.

## Recommended Next Implementation Prompt

Northstar CRM - Activity Saved Views Design

Design whether Activity saved views are worth adding after Deals, Leads, Contacts, and Organizations are stable. Do not implement runtime saved views yet. Inspect the current saved-view service/panel/actions, Activities list-state/filter shape, `SavedViewRecordType`, tests, and docs. Define whether an enum migration is justified, Activity state keys, stale payload behavior, test coverage, and exact runtime implementation prompt.

Do not add schema changes, Activity runtime saved views, Product saved views, sharing/private views, permissions redesign, query builder UI, multiple filters, AND/OR logic, saved reports, dashboard widgets, automations, background jobs, integrations, API keys/webhooks, or new modules.
