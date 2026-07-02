# Custom Field Filtering v1 Design

Status: implemented MVP. Enhanced custom-field filtering now supports one URL-backed custom field filter at a time with a small operator set; broader query-builder behavior remains deferred.

## Objective

Custom Field Filtering v1 should answer: "Can a sales user narrow a core CRM list by a simple custom-field condition without learning a query builder?"

The first practical step should improve the existing list filter contract for Deals, Leads, Contacts/People, and Organizations while preserving URL-backed list state and Deals saved-view behavior.

Custom Field Filtering v1 explicitly does not cover a multi-filter builder, advanced boolean logic, saved-view redesign, full-text search, reporting filters, automations, background jobs, schema changes, or new CRM modules.

## Current Behavior

Supported entities:

- `DEAL`
- `LEAD`
- `PERSON`
- `ORGANIZATION`

Custom field definitions are workspace-scoped and entity-scoped through `CustomFieldDefinition`. Values are stored in `CustomFieldValue` with `workspaceId`, `fieldId`, `entityType`, `entityId`, and a JSON `value`.

Editable/filterable field types today are:

- `TEXT`
- `NUMBER`
- `DATE`
- `BOOLEAN`

Editable-but-not-filterable field types today are:

- `SELECT`

Unsupported future field types such as multi-select and URL can exist in data, but current UI treats them as read-only/unsupported for editing and filtering.

Current list filtering:

- Deals, Leads, Contacts/People, and Organizations accept `customFieldId` and `customFieldValue` URL parameters.
- Deals, Leads, Contacts/People, and Organizations also accept `customFieldOperator`.
- The filter applies one custom field at a time.
- The service resolves the selected field inside the current workspace and entity type.
- Supported values are normalized by field type before querying.
- Missing `customFieldOperator` defaults to `equals` so existing URLs and saved views keep working.
- `equals` uses exact JSON equality.
- `contains` is available for `TEXT` fields only and is case-insensitive.
- `is_empty` and `is_not_empty` are available for `TEXT`, `NUMBER`, `DATE`, and `BOOLEAN`.
- Missing field/value means no custom-field filter is applied.
- Invalid field ids, unsupported field types, or invalid typed values fail closed to no matching records.

Saved-view interaction:

- Saved views are currently available for Deals, Leads, Contacts, and Organizations.
- Deals, Leads, Contacts, and Organizations saved views persist/reapply URL-backed list state except the transient page number.
- `customFieldId`, `customFieldOperator`, and `customFieldValue` are included in Deals, Leads, Contacts, and Organizations saved-view state.

## Operator Candidates

Possible operators by type:

- Text: `equals`, `contains`, `is_empty`, `is_not_empty`.
- Number: `equals`, `greater_than`, `less_than`, `is_empty`, `is_not_empty`.
- Date: `equals`, `before`, `after`, `is_empty`, `is_not_empty`.
- Boolean: `equals`, `is_empty`, `is_not_empty`.
- Select: `equals`, `is_empty`, `is_not_empty` only after select editing/filtering is intentionally supported.
- Multi-select: defer until array containment semantics are designed.
- URL: defer until URL editing/search semantics are designed.

## Recommended MVP

The implemented MVP is a single-filter operator expansion:

- Keep one custom field filter at a time.
- Keep `customFieldId` and `customFieldValue`.
- Add `customFieldOperator` with default `equals`.
- Preserve current exact-match behavior when `customFieldOperator` is missing.
- Persist `customFieldOperator` in Deals saved views.

Recommended v1 operators:

- `equals`: supported for `TEXT`, `NUMBER`, `DATE`, and `BOOLEAN`.
- `contains`: supported for `TEXT` only.
- `is_empty`: supported for `TEXT`, `NUMBER`, `DATE`, and `BOOLEAN`.
- `is_not_empty`: supported for `TEXT`, `NUMBER`, `DATE`, and `BOOLEAN`.

Defer these operators:

- Number `greater_than` and `less_than`.
- Date `before` and `after`.
- Select and multi-select operators.
- Multiple custom field filters.
- AND/OR grouping.
- Search integration.
- Reporting integration.

This keeps the implementation useful while avoiding misleading numeric/date comparisons on JSON storage before the query behavior is proven and test-pinned.

## Query Semantics

Single-filter semantics:

- No `customFieldId`: no custom-field filter.
- Missing `customFieldOperator`: treat as `equals`.
- Unknown operator: fail closed to no matches.
- Operator not supported for the field type: fail closed to no matches.
- Field id outside the current workspace/entity type: fail closed to no matches.
- `equals` and `contains` require a non-blank value.
- Blank value for a value-required operator should preserve current UX and behave as no custom-field filter.
- Invalid typed value after a field is selected should return no matches.
- `is_empty` and `is_not_empty` should ignore `customFieldValue`.

Empty semantics:

- Empty should include records with no `CustomFieldValue` row for the selected field.
- Empty should include JSON null values.
- Empty should include blank text values after trimming.
- Empty should not treat `0` or `false` as empty.
- Not empty should be the inverse for records in the current workspace/entity list.

Text contains semantics:

- Trim the input.
- `contains` is case-insensitive.
- The MVP filters candidate custom field value rows in the service helper instead of depending on provider-specific JSON string containment.

URL and saved-view semantics:

- URLs should remain stable and shareable.
- Existing `customFieldId`/`customFieldValue` URLs must continue to work as exact-match filters.
- Deals saved views should store `customFieldOperator` and should continue excluding only transient page number.
- Invalid URL state should not throw; it should either normalize away or return an empty result according to the rules above.

## Data And Model Constraints

Custom field values are stored as JSON, which is good for flexible exact matching but requires care for typed comparisons:

- `TEXT` values are JSON strings.
- `NUMBER` values are JSON numbers after normalization.
- `DATE` values are strict `YYYY-MM-DD` strings.
- `BOOLEAN` values are JSON booleans.
- Optional blank values can be represented by missing rows, JSON null, or blank strings depending on field type and legacy writes.

Exact equality is reliable today because values are normalized before storage and filtering.

Text contains is feasible as the first operator expansion because it only requires string matching on a single selected field.

Numeric greater-than/less-than and date before/after are riskier because JSON comparison support can be provider/version-specific, and lexicographic date comparison is only safe if every stored value is normalized to strict `YYYY-MM-DD`. These should wait for a dedicated helper and tests that prove behavior on the current PostgreSQL/Prisma stack.

No schema change is recommended for the next slice. If richer typed comparisons become a core workflow, a later design should consider typed shadow columns, generated indexes, or separate value columns instead of stretching JSON filters too far.

## Implemented Tests And Future Hardening

Implemented source/API and integration tests cover:

- Exact-match regression for current `customFieldId`/`customFieldValue` URLs.
- Workspace scoping.
- Entity scoping.
- Invalid field id.
- Unsupported field type.
- Unknown operator.
- Operator not allowed for selected type.
- Invalid typed value for number/date/boolean.
- `contains` on text values.
- Case-insensitive text contains.
- `is_empty` for missing row, JSON null, and blank text.
- `is_empty` does not treat `0` or `false` as empty.
- `is_not_empty` inverse behavior.
- Deals saved views persist and reapply `customFieldOperator`.
- Existing saved views without `customFieldOperator` continue as exact matches.
- URL normalization keeps page number transient and filter state stable.

Browser smoke should stay light: one stable assertion that a core list exposes the custom-field operator control is enough if UI changes are visible.

## Recommended Next Slice

Custom Field Filtering v1 MVP is implemented. The next sensible slice should be validation/readability only: run real customer-style examples across Deals, Leads, Contacts, and Organizations, and tighten copy/tests if operators confuse users.

Do not add number/date comparison operators, select/multi-select filtering, multiple filters, AND/OR grouping, reporting filters, saved-view redesign, search integration, schema changes, or a query builder until those semantics are designed separately.
