import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const newDealPage = readFileSync(join(process.cwd(), "app/deals/new/page.tsx"), "utf8");
const newContactPage = readFileSync(join(process.cwd(), "app/contacts/new/page.tsx"), "utf8");
const newOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/new/page.tsx"), "utf8");
const newLeadPage = readFileSync(join(process.cwd(), "app/leads/new/page.tsx"), "utf8");
const newActivityPage = readFileSync(join(process.cwd(), "app/activities/new/page.tsx"), "utf8");
const editDealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/edit/page.tsx"), "utf8");
const editContactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/edit/page.tsx"), "utf8");
const editOrganizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/edit/page.tsx"), "utf8");
const editLeadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/edit/page.tsx"), "utf8");
const editActivityPage = readFileSync(join(process.cwd(), "app/activities/[activityId]/edit/page.tsx"), "utf8");
const emptyState = readFileSync(join(process.cwd(), "components/empty-state.tsx"), "utf8");
const actionGroup = readFileSync(join(process.cwd(), "components/action-group.tsx"), "utf8");
const pageHeader = readFileSync(join(process.cwd(), "components/page-header.tsx"), "utf8");
const formHeaderActions = readFileSync(join(process.cwd(), "components/form-header-actions.tsx"), "utf8");
const formActionBar = readFileSync(join(process.cwd(), "components/form-action-bar.tsx"), "utf8");
const formErrorMessage = readFileSync(join(process.cwd(), "components/form-error-message.tsx"), "utf8");
const formFieldLabel = readFileSync(join(process.cwd(), "components/form-field-label.tsx"), "utf8");
const formSection = readFileSync(join(process.cwd(), "components/form-section.tsx"), "utf8");
const formSuccessMessage = readFileSync(join(process.cwd(), "components/form-success-message.tsx"), "utf8");
const formCallout = readFileSync(join(process.cwd(), "components/form-callout.tsx"), "utf8");
const formIntroCallout = readFileSync(join(process.cwd(), "components/form-intro-callout.tsx"), "utf8");
const formPrefillNotice = readFileSync(join(process.cwd(), "components/form-prefill-notice.tsx"), "utf8");
const formRelatedRecordCallout = readFileSync(join(process.cwd(), "components/form-related-record-callout.tsx"), "utf8");
const lockedPanelNotice = readFileSync(join(process.cwd(), "components/locked-panel-notice.tsx"), "utf8");
const recordLockedNotice = readFileSync(join(process.cwd(), "components/record-locked-notice.tsx"), "utf8");
const dealForm = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");
const contactForm = readFileSync(join(process.cwd(), "components/contact-form.tsx"), "utf8");
const organizationForm = readFileSync(join(process.cwd(), "components/organization-form.tsx"), "utf8");
const leadForm = readFileSync(join(process.cwd(), "components/lead-form.tsx"), "utf8");
const activityForm = readFileSync(join(process.cwd(), "components/activity-form.tsx"), "utf8");
const activityEditForm = readFileSync(join(process.cwd(), "components/activity-edit-form.tsx"), "utf8");
const activityFormGuidance = readFileSync(join(process.cwd(), "components/activity-form-guidance.tsx"), "utf8");
const activityDueDateShortcuts = readFileSync(join(process.cwd(), "components/activity-due-date-shortcuts.tsx"), "utf8");
const activityCompleteButton = readFileSync(join(process.cwd(), "components/activity-complete-button.tsx"), "utf8");
const activityDeleteButton = readFileSync(join(process.cwd(), "components/activity-delete-button.tsx"), "utf8");
const noteForm = readFileSync(join(process.cwd(), "components/note-form.tsx"), "utf8");
const noteDeleteButton = readFileSync(join(process.cwd(), "components/note-delete-button.tsx"), "utf8");
const recordCustomFieldsForm = readFileSync(join(process.cwd(), "components/record-custom-fields-form.tsx"), "utf8");
const leadConversionForm = readFileSync(join(process.cwd(), "components/lead-conversion-form.tsx"), "utf8");
const dealStageMoveForm = readFileSync(join(process.cwd(), "components/deal-stage-move-form.tsx"), "utf8");
const dealCloseActions = readFileSync(join(process.cwd(), "components/deal-close-actions.tsx"), "utf8");
const dealLineItemsPanel = readFileSync(join(process.cwd(), "components/deal-line-items-panel.tsx"), "utf8");
const productCreateForm = readFileSync(join(process.cwd(), "components/product-create-form.tsx"), "utf8");
const customFieldDefinitionForm = readFileSync(join(process.cwd(), "components/custom-field-definition-form.tsx"), "utf8");
const manualEmailLogPanel = readFileSync(join(process.cwd(), "components/manual-email-log-panel.tsx"), "utf8");
const quoteAdjustmentsForm = readFileSync(join(process.cwd(), "components/quote-adjustments-form.tsx"), "utf8");
const quoteDealValueSyncAction = readFileSync(join(process.cwd(), "components/quote-deal-value-sync-action.tsx"), "utf8");
const quoteDraftsPanel = readFileSync(join(process.cwd(), "components/quote-drafts-panel.tsx"), "utf8");
const quotePublicLinkControls = readFileSync(join(process.cwd(), "components/quote-public-link-controls.tsx"), "utf8");
const quoteStatusActions = readFileSync(join(process.cwd(), "components/quote-status-actions.tsx"), "utf8");
const accountSettingsForm = readFileSync(join(process.cwd(), "app/settings/account-settings-form.tsx"), "utf8");
const workspaceInviteForm = readFileSync(join(process.cwd(), "app/settings/workspace-invite-form.tsx"), "utf8");
const createWorkspaceForm = readFileSync(join(process.cwd(), "app/settings/create-workspace-form.tsx"), "utf8");
const emailTemplatesPanel = readFileSync(join(process.cwd(), "app/settings/email-templates-panel.tsx"), "utf8");
const importFormShared = readFileSync(join(process.cwd(), "app/settings/import-export/import-form-shared.tsx"), "utf8");
const contractWorkflowPanel = readFileSync(join(process.cwd(), "components/contract-workflow-panel.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("CRM form header UX", () => {
  it("gives create forms clear orientation and list return actions", () => {
    for (const page of [newDealPage, newContactPage, newOrganizationPage, newLeadPage, newActivityPage]) {
      expect(page).toContain("PageHeader");
      expect(page).not.toContain("<header className=\"page-header\">");
      expect(page).toContain("FormHeaderActions");
    }
    expect(pageHeader).toContain("className=\"page-subtitle\"");
    expect(pageHeader).toContain("className=\"header-actions\"");
    expect(pageHeader).toContain("import { ActionGroup }");
    expect(pageHeader).toContain("<ActionGroup className=\"header-actions\" label={resolvedActionsLabel}>");
    expect(actionGroup).toContain("aria-label={label}");
    expect(actionGroup).toContain("role=\"group\"");
    expect(formHeaderActions).toContain("export function FormHeaderActions");
    expect(formHeaderActions).toContain("showCustomFieldsLink = false");
    expect(formHeaderActions).toContain("href={\"#custom-fields\" as Route}");
    expect(formHeaderActions).toContain("aria-label=\"Jump to custom fields in this form\"");
    expect(formHeaderActions).toContain("title=\"Jump to custom fields\"");
    expect(formHeaderActions).toContain("aria-label={backLabel}");
    expect(formHeaderActions).toContain("title={backLabel}");
    expect(formHeaderActions).toContain("className=\"button-secondary\"");

    expect(newDealPage).toContain("Create a pipeline opportunity with value, stage, owner, and related customer context.");
    expect(newDealPage).toContain("backHref={returnHref}");
    expect(newDealPage).toContain("cancelHref={returnHref}");
    expect(newDealPage).toContain("const returnLabel = returnToLabel(returnHref)");
    expect(newDealPage).toContain("prefillNotice={");
    expect(newDealPage).toContain("We prefilled this deal from your search or related-record shortcut.");
    expect(newContactPage).toContain("Add a person record that can be linked to deals, organizations, activities, and email.");
    expect(newContactPage).toContain("backHref=\"/contacts\"");
    expect(newContactPage).toContain("cancelHref={(returnTo ?? \"/contacts\") as Route}");
    expect(newContactPage).toContain("prefillNotice={");
    expect(newContactPage).toContain("We prefilled this contact from your search or related-record shortcut.");
    expect(newContactPage).toContain("Northstar will return to the source form with the contact selected.");
    expect(newOrganizationPage).toContain("Create an account record for grouping contacts, deals, activities, and notes.");
    expect(newOrganizationPage).toContain("backHref=\"/organizations\"");
    expect(newOrganizationPage).toContain("cancelHref={(returnTo ?? \"/organizations\") as Route}");
    expect(newOrganizationPage).toContain("prefillNotice={");
    expect(newOrganizationPage).toContain("We prefilled this organization from your search shortcut.");
    expect(newOrganizationPage).toContain("Northstar will return to the source form with the company selected.");
    expect(newLeadPage).toContain("Capture an early opportunity before it is qualified into the active deal pipeline.");
    expect(newLeadPage).toContain("backHref={returnHref}");
    expect(newLeadPage).toContain("cancelHref={returnHref}");
    expect(newLeadPage).toContain("const returnLabel = returnToLabel(returnHref)");
    expect(newLeadPage).toContain("prefillNotice={");
    expect(newLeadPage).toContain("We prefilled this lead from your search shortcut.");
    expect(newActivityPage).toContain("Schedule the next call, email, meeting, or task against a CRM record.");
    expect(newActivityPage).toContain("backHref={returnHref}");
    expect(newActivityPage).toContain("const returnLabel = returnToLabel(returnHref)");
    expect(newActivityPage).toContain("backLabel={returnLabel}");
    expect(newActivityPage).toContain("cancelHref={returnHref}");
    expect(newActivityPage).toContain("We prefilled this activity from your search or record shortcut.");
  });

  it("gives edit forms clear orientation and detail return actions without changing locks", () => {
    for (const page of [editDealPage, editContactPage, editOrganizationPage, editLeadPage, editActivityPage]) {
      expect(page).toContain("PageHeader");
      expect(page).not.toContain("<header className=\"page-header\">");
    }
    expect(pageHeader).toContain("className=\"page-subtitle\"");
    expect(pageHeader).toContain("className=\"header-actions\"");

    expect(editDealPage).toContain("Update core deal fields while custom fields stay grouped below the main form.");
    expect(editDealPage).toContain("FormHeaderActions");
    expect(editDealPage).toContain("showCustomFieldsLink={deal.status === \"OPEN\"}");
    expect(editDealPage).toContain("backHref={`/deals/${deal.id}` as Route}");
    expect(editDealPage).toContain("cancelHref={`/deals/${deal.id}` as Route}");
    expect(editDealPage).toContain("Closed deals are locked");
    expect(editDealPage).toContain("RecordLockedNotice");
    expect(editDealPage).toContain("actions={[{ href: `/deals/${deal.id}`, label: \"Back to deal\" }]}");
    expect(editDealPage).not.toContain("<section className=\"empty-state\">");
    expect(editContactPage).toContain("Keep contact details, ownership, organization, and custom fields current.");
    expect(editContactPage).toContain("FormHeaderActions");
    expect(editContactPage).toContain("showCustomFieldsLink");
    expect(editContactPage).toContain("backHref={`/contacts/${person.id}` as Route}");
    expect(editContactPage).toContain("cancelHref={`/contacts/${person.id}` as Route}");
    expect(editOrganizationPage).toContain("Maintain company ownership, domain, and custom account fields.");
    expect(editOrganizationPage).toContain("FormHeaderActions");
    expect(editOrganizationPage).toContain("showCustomFieldsLink");
    expect(editOrganizationPage).toContain("backHref={`/organizations/${organization.id}` as Route}");
    expect(editOrganizationPage).toContain("cancelHref={`/organizations/${organization.id}` as Route}");
    expect(editLeadPage).toContain("Update lead qualification details before conversion locks the record.");
    expect(editLeadPage).toContain("FormHeaderActions");
    expect(editLeadPage).toContain("showCustomFieldsLink={lead.status !== \"CONVERTED\"}");
    expect(editLeadPage).toContain("backHref={`/leads/${lead.id}` as Route}");
    expect(editLeadPage).toContain("cancelHref={`/leads/${lead.id}` as Route}");
    expect(editLeadPage).toContain("Converted leads are locked");
    expect(editLeadPage).toContain("RecordLockedNotice");
    expect(editLeadPage).toContain("badge={<StatusBadge status={lead.status} />}");
    expect(editLeadPage).not.toContain("<section className=\"empty-state\">");
    expect(editActivityPage).toContain("Adjust the owner, due date, type, and details for this open follow-up.");
    expect(editActivityPage).toContain("Completed follow-ups are locked; review the context or create the next follow-up.");
    expect(editActivityPage).toContain('const pageTitle = activityCompleted ? "Activity details" : "Edit activity"');
    expect(editActivityPage).toContain("FormHeaderActions");
    expect(editActivityPage).toContain("backHref={redirectTo}");
    expect(editActivityPage).toContain("backLabel={returnLabel}");
    expect(editActivityPage).toContain("const defaultReturnPath = getActivityReturnPath(activity)");
    expect(editActivityPage).toContain("parseReturnToHref(resolvedSearchParams?.returnTo, defaultReturnPath)");
    expect(editActivityPage).toContain("const returnLabel = redirectTo === defaultReturnPath ? getActivityReturnLabel(activity) : returnToLabel(redirectTo)");
    expect(editActivityPage).toContain("cancelLabel={returnLabel}");
    expect(editActivityPage).toContain("function getActivityReturnLabel");
    expect(editActivityPage).toContain("return \"Back to deal\"");
    expect(editActivityPage).toContain("return \"Back to lead\"");
    expect(editActivityPage).toContain("return \"Back to contact\"");
    expect(editActivityPage).toContain("return \"Back to organization\"");
    expect(editActivityPage).toContain("return \"Back to activities\"");
    expect(editActivityPage).toContain("Completed activities are locked");
    expect(editActivityPage).toContain("RecordLockedNotice");
  });

  it("uses a shared action bar with explicit cancel destinations on primary CRM forms", () => {
    expect(formActionBar).toContain("export function FormActionBar");
    expect(formActionBar).toContain("actionsLabel?: string");
    expect(formActionBar).toContain("actionsLabel = \"Form actions\"");
    expect(formActionBar).toContain("const resolvedActionsLabel");
    expect(formActionBar).toContain("actionsLabel === \"Form actions\" ? `${resolvedSubmitActionLabel} form actions` : actionsLabel");
    expect(formActionBar).toContain("import { ActionGroup }");
    expect(formActionBar).toContain("<ActionGroup className={actionBarClassName} label={resolvedActionsLabel}>");
    expect(formActionBar).toContain("cancelHref?: Route");
    expect(formActionBar).toContain("cancelLabel?: string");
    expect(formActionBar).toContain("cancelLabel = \"Cancel\"");
    expect(formActionBar).toContain("compact?: boolean");
    expect(formActionBar).toContain("disabledHint?: string");
    expect(formActionBar).toContain("disabledHintId?: string");
    expect(formActionBar).toContain("submitActionLabel?: string");
    expect(formActionBar).toContain("disabledHint = \"Complete required fields to continue.\"");
    expect(formActionBar).toContain("const showDisabledHint = submitDisabled && !isSaving");
    expect(formActionBar).toContain("import { useId } from \"react\"");
    expect(formActionBar).toContain("const generatedHintId = useId()");
    expect(formActionBar).toContain("const hintId = disabledHintId ?? `${generatedHintId}-form-action-hint`");
    expect(formActionBar).toContain("const resolvedPendingLabel = pendingLabel ?? defaultPendingLabel(submitLabel)");
    expect(formActionBar).toContain("const resolvedSubmitActionLabel = submitActionLabel ?? submitLabel");
    expect(formActionBar).toContain("const submitAriaLabel = isSaving ? resolvedPendingLabel : resolvedSubmitActionLabel");
    expect(formActionBar).toContain("const submitTitle = showDisabledHint ? `${submitAriaLabel}: ${disabledHint}` : submitAriaLabel");
    expect(formActionBar).toContain("actionsLabel === \"Form actions\" ? `${resolvedSubmitActionLabel} form actions` : actionsLabel");
    expect(formActionBar).toContain("const cancelActionLabel = cancelLabel === \"Cancel\" ? `Cancel ${submitLabel.toLowerCase()} form` : cancelLabel");
    expect(formActionBar).toContain("const actionBarClassName = [\"form-actions\", compact ? \"form-actions-compact\" : null].filter(Boolean).join(\" \")");
    expect(formActionBar).toContain("aria-describedby={showDisabledHint ? hintId : undefined}");
    expect(formActionBar).toContain("aria-label={submitAriaLabel}");
    expect(formActionBar).toContain("title={submitTitle}");
    expect(formActionBar).toContain("aria-label={cancelActionLabel}");
    expect(formActionBar).toContain("title={cancelActionLabel}");
    expect(formActionBar).toContain("className=\"form-action-hint\"");
    expect(formActionBar).toContain("id={hintId}");
    expect(formActionBar).toContain("aria-live=\"polite\"");
    expect(formActionBar).not.toContain("function formActionId");
    expect(formActionBar).toContain("function defaultPendingLabel");
    expect(formActionBar).toContain("normalizedVerb === \"create\" || normalizedVerb === \"add\"");
    expect(formActionBar).toContain("return \"Creating...\"");
    expect(formActionBar).toContain("normalizedVerb === \"convert\"");
    expect(formActionBar).toContain("return \"Converting...\"");
    expect(formActionBar).toContain("normalizedVerb === \"move\"");
    expect(formActionBar).toContain("return \"Moving...\"");
    expect(formActionBar).toContain("normalizedVerb === \"update\"");
    expect(formActionBar).toContain("return \"Updating...\"");
    expect(formActionBar).toContain("return \"Saving...\"");
    expect(formActionBar).toContain("button-primary button-compact");
    expect(formActionBar).toContain("className={actionBarClassName}");
    expect(formActionBar).toContain("<Link aria-label={cancelActionLabel} className=\"button-secondary\" href={cancelHref} title={cancelActionLabel}>");
    expect(formActionBar).toContain("isSaving ? resolvedPendingLabel : submitLabel");
    expect(globalStyles).toContain(".form-action-hint");
    expect(globalStyles).toContain(".form-actions-compact");
    expect(globalStyles).toContain("justify-content: flex-end;");
    expect(globalStyles).toContain("text-align: right;");
    expect(globalStyles).toContain("flex-basis: 100%;");
    expect(globalStyles).toContain("max-width: 100%;");
    expect(globalStyles).toContain(".button-primary,\n.button-secondary");
    expect(globalStyles).toContain("min-width: 0;");
    expect(globalStyles).toContain("line-height: 1.25;");
    expect(globalStyles).toContain("overflow-wrap: anywhere;");
    expect(globalStyles).toContain("white-space: normal;");
    expect(formErrorMessage).toContain("export function FormErrorMessage");
    expect(formErrorMessage).toContain("role=\"alert\"");
    expect(formErrorMessage).toContain("\"form-error\"");
    expect(formErrorMessage).toContain("compact ? \"compact-error\" : null");
    expect(formSuccessMessage).toContain("export function FormSuccessMessage");
    expect(formSuccessMessage).toContain("role=\"status\"");
    expect(formSuccessMessage).toContain("aria-live=\"polite\"");
    expect(formSuccessMessage).toContain("compact ? \"compact-success\" : \"form-success\"");

    for (const form of [dealForm, contactForm, organizationForm, leadForm, activityEditForm]) {
      expect(form).toContain("FormActionBar");
      expect(form).toContain("FormErrorMessage");
      expect(form).toContain("{error ? <FormErrorMessage>{error}</FormErrorMessage> : null}");
      expect(form).toContain("cancelHref");
      expect(form).toContain("cancelLabel");
      expect(form).toContain("disabledHint=");
      expect(form).not.toContain("router.back()");
    }

    expect(activityForm).toContain("cancelHref?: Route");
    expect(activityForm).toContain("cancelLabel?: string");
    expect(activityForm).toContain("FormErrorMessage");
    expect(newActivityPage).toContain("const returnLabel = returnToLabel(returnHref)");
    expect(newActivityPage).toContain("cancelLabel={returnLabel}");
    expect(dealForm).toContain("cancelLabel={mode === \"create\" ? \"Back to deals\" : \"Back to deal\"}");
    expect(contactForm).toContain("cancelLabel={mode === \"create\" ? \"Back to contacts\" : \"Back to contact\"}");
    expect(organizationForm).toContain("cancelLabel={mode === \"create\" ? \"Back to organizations\" : \"Back to organization\"}");
    expect(leadForm).toContain("cancelLabel={mode === \"create\" ? \"Back to leads\" : \"Back to lead\"}");
    expect(activityEditForm).toContain("cancelLabel?: string");
    expect(activityEditForm).toContain("cancelLabel = \"Back to activity\"");
    expect(activityEditForm).toContain("cancelLabel={cancelLabel}");
    expect(activityForm).toContain("Add an activity title and choose a related record before saving.");
    expect(activityForm).toContain("pendingLabel=\"Adding...\"");
    expect(activityForm).not.toContain("router.back()");
  });

  it("standardizes sectioned form structure and mobile-safe field grouping", () => {
    expect(formSection).toContain("export function FormSection");
    expect(formSection).toContain('className={["form-section", className].filter(Boolean).join(" ")}');
    expect(formSection).toContain('className="form-section-header"');
    expect(formSection).toContain('className="form-section-title"');
    expect(formSection).toContain('className="form-section-description"');
    expect(globalStyles).toContain(".form-section");
    expect(globalStyles).toContain(".form-section + .form-section");
    expect(globalStyles).toContain(".form-section-header");
    expect(globalStyles).toContain(".form-section-title");
    expect(globalStyles).toContain(".form-section-description");
    expect(globalStyles).toContain(".form-section-compact");
    expect(globalStyles).toContain(".form-field .form-field-label {\n    align-items: flex-start;");
    expect(globalStyles).toContain(".form-actions > * {\n    max-width: 100%;");
    expect(globalStyles).toContain(".form-related-record-actions {\n  display: grid;");
    expect(globalStyles).toContain(".form-related-record-actions .inline-link");

    for (const form of [
      dealForm,
      contactForm,
      organizationForm,
      leadForm,
      activityForm,
      activityEditForm,
      productCreateForm,
      quoteAdjustmentsForm,
      accountSettingsForm,
      workspaceInviteForm,
      createWorkspaceForm
    ]) {
      expect(form).toContain('import { FormSection } from "@/components/form-section"');
      expect(form).toContain("<FormSection");
    }

    expect(dealForm).toContain('title="Deal details"');
    expect(dealForm).toContain('title="Relationships and owner"');
    expect(contactForm).toContain('title="Contact details"');
    expect(contactForm).toContain('title="Organization and owner"');
    expect(organizationForm).toContain('title="Organization details"');
    expect(leadForm).toContain('title="Lead details"');
    expect(leadForm).toContain('title="Related records"');
    expect(activityForm).toContain('title="Activity details"');
    expect(activityForm).toContain('title="Related record"');
    expect(activityEditForm).toContain('title="Activity details"');
    expect(productCreateForm).toContain('title={mode === "create" ? "Product details" : "Edit product"}');
    expect(productCreateForm).toContain('className={variant === "compact" ? "form-section-compact" : undefined}');
    expect(quoteAdjustmentsForm).toContain('title="Adjustment inputs"');
    expect(quoteAdjustmentsForm).toContain("Percent for percentage-based changes");
    expect(accountSettingsForm).toContain('title="Account details"');
    expect(workspaceInviteForm).toContain('title="Invitation details"');
    expect(createWorkspaceForm).toContain('title="Workspace details"');
    expect(importFormShared).toContain('className="form-field import-csv-field"');
    expect(globalStyles).toContain(".import-csv-field .form-label");
    expect(globalStyles).toContain(".import-textarea:focus");
  });

  it("marks required and optional fields consistently on primary CRM forms", () => {
    expect(formFieldLabel).toContain("export function FormFieldLabel");
    expect(formFieldLabel).toContain("className=\"form-field-label\"");
    expect(formFieldLabel).toContain("const requirementLabel = required ? \"Required field\" : \"Optional field\"");
    expect(formFieldLabel).toContain('import { Badge } from "@/components/badge"');
    expect(formFieldLabel).toContain("<Badge label={requirementLabel}>");
    expect(formFieldLabel).toContain("required ? \"Required\" : \"Optional\"");
    expect(globalStyles).toContain(".form-field .form-field-label");
    expect(globalStyles).toContain(".form-field .form-field-label .badge");
    expect(globalStyles).toContain(".form-grid");
    expect(globalStyles).toContain(".form-field {\n  display: grid;\n  gap: 6px;\n  min-width: 0;");
    expect(globalStyles).toContain(".form-field input,\n.form-field select,\n.form-field textarea {\n  min-width: 0;\n  max-width: 100%;");
    expect(globalStyles).toContain("@media (max-width: 760px) {\n  .form-grid {\n    grid-template-columns: 1fr;");
    expect(globalStyles).toContain(".form-actions {\n    justify-content: flex-start;");
    expect(globalStyles).toContain(".form-action-hint {\n    text-align: left;");

    for (const form of [dealForm, contactForm, organizationForm, leadForm, activityForm, activityEditForm]) {
      expect(form).toContain("FormFieldLabel");
    }

    expect(dealForm).toContain("<FormFieldLabel required>Title</FormFieldLabel>");
    expect(dealForm).toContain("<FormFieldLabel required>Currency</FormFieldLabel>");
    expect(dealForm).toContain("<FormFieldLabel required>Stage</FormFieldLabel>");
    expect(dealForm).toContain("<FormFieldLabel>Person</FormFieldLabel>");
    expect(contactForm).toContain("<FormFieldLabel required>Name</FormFieldLabel>");
    expect(contactForm).toContain("<FormFieldLabel>Email</FormFieldLabel>");
    expect(organizationForm).toContain("<FormFieldLabel required>Name</FormFieldLabel>");
    expect(leadForm).toContain("<FormFieldLabel required>Title</FormFieldLabel>");
    expect(activityForm).toContain("<FormFieldLabel required>Related record</FormFieldLabel>");
    expect(activityEditForm).toContain("<FormFieldLabel required>Title</FormFieldLabel>");
    expect(noteForm).toContain("<FormFieldLabel required>Internal note</FormFieldLabel>");
    expect(recordCustomFieldsForm).toContain("<FormFieldLabel required={field.required}>{field.name}</FormFieldLabel>");
    expect(leadConversionForm).toContain("<FormFieldLabel required>Pipeline</FormFieldLabel>");
    expect(leadConversionForm).toContain("<FormFieldLabel required>Stage</FormFieldLabel>");
    expect(leadConversionForm).toContain("<FormFieldLabel>Deal title</FormFieldLabel>");
    expect(dealStageMoveForm).toContain("<FormFieldLabel required>Move to stage</FormFieldLabel>");
    expect(dealCloseActions).toContain("<FormFieldLabel>Lost reason</FormFieldLabel>");
    expect(productCreateForm).toContain("<FormFieldLabel required>Name</FormFieldLabel>");
    expect(productCreateForm).toContain("<FormFieldLabel required>Unit price</FormFieldLabel>");
    expect(productCreateForm).toContain("<FormFieldLabel required>Currency</FormFieldLabel>");
    expect(productCreateForm).toContain("<FormFieldLabel>Description</FormFieldLabel>");
    expect(quoteAdjustmentsForm).toContain("<FormFieldLabel>{label} type</FormFieldLabel>");
    expect(quoteAdjustmentsForm).toContain("<FormFieldLabel>{label} value</FormFieldLabel>");
    expect(quotePublicLinkControls).toContain("<FormFieldLabel>Public URL</FormFieldLabel>");
    expect(accountSettingsForm).toContain("<FormFieldLabel required>Display name</FormFieldLabel>");
    expect(createWorkspaceForm).toContain("<FormFieldLabel required>Workspace name</FormFieldLabel>");
    expect(workspaceInviteForm).toContain("<FormFieldLabel required>Email</FormFieldLabel>");
    expect(workspaceInviteForm).toContain("<FormFieldLabel required>Role</FormFieldLabel>");
    expect(emailTemplatesPanel).toContain("<FormFieldLabel required>Name</FormFieldLabel>");
    expect(emailTemplatesPanel).toContain("<FormFieldLabel required>Subject</FormFieldLabel>");
    expect(emailTemplatesPanel).toContain("<FormFieldLabel required>Body</FormFieldLabel>");
    expect(manualEmailLogPanel).toContain("<FormFieldLabel>Template</FormFieldLabel>");
    expect(manualEmailLogPanel).toContain("<FormFieldLabel required>Direction</FormFieldLabel>");
    expect(manualEmailLogPanel).toContain("<FormFieldLabel required>Email date</FormFieldLabel>");
    expect(manualEmailLogPanel).toContain("<FormFieldLabel required>Subject</FormFieldLabel>");
    expect(manualEmailLogPanel).toContain("<FormFieldLabel required>Body</FormFieldLabel>");
    expect(dealLineItemsPanel).toContain("<FormFieldLabel required>Product</FormFieldLabel>");
    expect(dealLineItemsPanel).toContain("<FormFieldLabel required>Quantity</FormFieldLabel>");
    expect(dealLineItemsPanel).toContain("<FormFieldLabel>Description override</FormFieldLabel>");
    expect(contractWorkflowPanel).toContain("<FormFieldLabel required>Status</FormFieldLabel>");
    expect(contractWorkflowPanel).toContain("<FormFieldLabel>Owner</FormFieldLabel>");
    expect(contractWorkflowPanel).toContain("<FormFieldLabel>Due</FormFieldLabel>");
    expect(contractWorkflowPanel).toContain("<FormFieldLabel>Sent</FormFieldLabel>");
    expect(contractWorkflowPanel).toContain("<FormFieldLabel>Signed</FormFieldLabel>");
    expect(contractWorkflowPanel).toContain("<FormFieldLabel>Document ref</FormFieldLabel>");
    expect(contractWorkflowPanel).toContain("<FormFieldLabel>Notes</FormFieldLabel>");
  });

  it("shares form intro guidance across core CRM create forms", () => {
    expect(formCallout).toContain("export function FormCallout");
    expect(formCallout).toContain("role?: AriaRole");
    expect(formCallout).toContain("titleAttribute?: string");
    expect(formCallout).toContain('className={["form-callout", className].filter(Boolean).join(" ")}');
    expect(formCallout).toContain('className="form-callout-copy"');
    expect(formIntroCallout).toContain("export function FormIntroCallout");
    expect(formIntroCallout).toContain("import { FormCallout }");
    expect(formIntroCallout).toContain("className?: string");
    expect(formIntroCallout).toContain("details?: ReactNode");
    expect(formIntroCallout).toContain("title = \"Before you save\"");
    expect(formIntroCallout).toContain('className={["form-intro-copy", className].filter(Boolean).join(" ")}');
    expect(formIntroCallout).toContain("details={details}");
    expect(formIntroCallout).not.toContain("\"form-callout form-intro-copy\"");
    expect(globalStyles).toContain(".form-intro-copy .form-callout-copy");
    expect(globalStyles).toContain(".form-callout {\n  min-width: 0;");
    expect(globalStyles).toContain(".form-callout strong");
    expect(globalStyles).toContain("overflow-wrap: anywhere;");
    expect(formPrefillNotice).toContain("export function FormPrefillNotice");
    expect(formPrefillNotice).toContain("form-prefill-notice");
    expect(globalStyles).toContain(".form-prefill-notice");
    expect(globalStyles).toContain("background: #f8fbff;");
    expect(globalStyles).toContain("color: var(--muted-strong);");

    for (const form of [dealForm, contactForm, organizationForm, leadForm, newActivityPage, editActivityPage]) {
      expect(form).toContain("FormIntroCallout");
      expect(form).not.toContain("empty-copy form-intro-copy");
    }
    for (const form of [dealForm, contactForm, organizationForm, leadForm]) {
      expect(form).toContain("FormPrefillNotice");
      expect(form).not.toContain("<p className=\"form-hint form-callout-copy\">{prefillNotice}</p>");
    }
    expect(newActivityPage).toContain("title=\"Prefilled follow-up\"");
    expect(editActivityPage).toContain("title=\"Linked record\"");
  });

  it("shares locked-record notices on edit pages without changing lock copy", () => {
    expect(recordLockedNotice).toContain("export function RecordLockedNotice");
    expect(recordLockedNotice).toContain("import { EmptyState } from \"@/components/empty-state\"");
    expect(recordLockedNotice).toContain("<EmptyState");
    expect(recordLockedNotice).toContain("actionsLabel=\"Locked record actions\"");
    expect(recordLockedNotice).toContain("className=\"record-locked-notice\"");
    expect(recordLockedNotice).toContain("description={children}");
    expect(recordLockedNotice).toContain("leading={badge}");
    expect(recordLockedNotice).toContain("titleLevel=\"h2\"");
    expect(recordLockedNotice).toContain("actions.map");
    expect(recordLockedNotice).toContain("const actionLabel = `${action.label}: ${title}`");
    expect(recordLockedNotice).toContain("aria-label={actionLabel}");
    expect(recordLockedNotice).toContain("title={actionLabel}");
    expect(recordLockedNotice).toContain("button-primary");
    expect(recordLockedNotice).toContain("button-secondary");
    expect(emptyState).toContain("leading?: ReactNode");
    expect(emptyState).toContain("titleId?: string");
    expect(emptyState).toContain("import { useId, type ReactNode } from \"react\"");
    expect(emptyState).toContain("const generatedTitleId = useId()");
    expect(emptyState).toContain("const resolvedTitleId = titleId ?? `${generatedTitleId}-empty-state-title`");
    expect(emptyState).toContain("aria-labelledby={resolvedTitleId}");
    expect(emptyState).toContain("<Heading id={resolvedTitleId}>{title}</Heading>");
    expect(emptyState).not.toContain("aria-label={fallbackLabel}");
    expect(emptyState).toContain("actionsLabel = \"Empty state actions\"");
    expect(emptyState).toContain("const resolvedActionsLabel");
    expect(emptyState).toContain("actionsLabel === \"Empty state actions\" && typeof title === \"string\" ? `${title} actions` : actionsLabel");
    expect(emptyState).toContain("import { ActionGroup }");
    expect(emptyState).toContain("<ActionGroup className=\"empty-state-actions filter-actions\" label={resolvedActionsLabel}>");
    expect(globalStyles).toContain(".empty-state-actions");
    expect(actionGroup).toContain("title={label}");
    expect(emptyState).toContain("{leading}");
    expect(lockedPanelNotice).toContain("role=\"note\"");
    expect(lockedPanelNotice).toContain("FormCallout");
    expect(lockedPanelNotice).toContain("ariaLabel={title}");
    expect(lockedPanelNotice).toContain("titleAttribute={title}");
    expect(lockedPanelNotice).toContain("className=\"locked-panel-notice\"");
    expect(lockedPanelNotice).not.toContain("className=\"form-callout locked-panel-notice\"");
    expect(editDealPage).toContain("Edit fields are disabled after a deal is marked won or lost.");
    expect(editLeadPage).toContain("This lead has already become a deal, so edit the deal record instead.");
    expect(editActivityPage).toContain("This activity was completed on {formatDate(activity.completedAt)}");
  });

  it("shares related-record setup guidance across deal and lead forms", () => {
    expect(formRelatedRecordCallout).toContain("export function FormRelatedRecordCallout");
    expect(formRelatedRecordCallout).toContain("PanelTitleRow");
    expect(formRelatedRecordCallout).toContain("className=\"data-card form-related-callout\"");
    expect(formRelatedRecordCallout).toContain('const actionsLabel = "Related record setup actions"');
    expect(formRelatedRecordCallout).toContain("import { ActionGroup }");
    expect(formRelatedRecordCallout).toContain('<ActionGroup className="filter-actions" label={actionsLabel}>');
    expect(formRelatedRecordCallout).toContain("Add a contact");
    expect(formRelatedRecordCallout).toContain("aria-label=\"Create a contact for this related record setup\"");
    expect(formRelatedRecordCallout).toContain("title=\"Create a contact for this related record setup\"");
    expect(formRelatedRecordCallout).toContain("Add an organization");
    expect(formRelatedRecordCallout).toContain("aria-label=\"Create an organization for this related record setup\"");
    expect(formRelatedRecordCallout).toContain("title=\"Create an organization for this related record setup\"");
    expect(formRelatedRecordCallout).toContain("Import contacts");
    expect(formRelatedRecordCallout).toContain("aria-label=\"Open import and export settings for contact setup\"");
    expect(formRelatedRecordCallout).toContain("title=\"Open import and export settings for contact setup\"");
    expect(dealForm).toContain("FormRelatedRecordCallout");
    expect(dealForm).toContain("title=\"Missing related records?\"");
    expect(dealForm).toContain("showImportContactsAction");
    expect(dealForm).toContain("EmptyState");
    expect(dealForm).toContain("title=\"No stages available\"");
    expect(dealForm).not.toContain("<div className=\"empty-state\">");
    expect(leadForm).toContain("FormRelatedRecordCallout");
    expect(leadForm).toContain("title=\"Need a related record?\"");
    expect(leadForm).not.toContain("<h2 className=\"panel-title\">Need a related record?</h2>");
  });

  it("uses the shared action bar on compact workflow forms", () => {
    for (const form of [noteForm, recordCustomFieldsForm, leadConversionForm]) {
      expect(form).toContain("FormActionBar");
    }

    expect(noteForm).toContain("submitDisabled={!body.trim()}");
    expect(noteForm).toContain("FormErrorMessage");
    expect(noteForm).toContain("submitLabel=\"Save note\"");
    expect(noteForm).not.toContain("<div className=\"form-actions\">");
    expect(recordCustomFieldsForm).toContain("FormErrorMessage");
    expect(recordCustomFieldsForm).toContain("<FormErrorMessage compact>{error}</FormErrorMessage>");
    expect(recordCustomFieldsForm).toContain("submitLabel=\"Save custom fields\"");
    expect(recordCustomFieldsForm).not.toContain("<div className=\"form-actions\">");
    expect(leadConversionForm).toContain("FormErrorMessage");
    expect(leadConversionForm).toContain("pendingLabel=\"Converting...\"");
    expect(leadConversionForm).toContain("Choose a pipeline and stage before converting this lead.");
    expect(leadConversionForm).toContain("submitDisabled={!pipelineId || !stageId}");
    expect(leadConversionForm).toContain("submitLabel=\"Convert to deal\"");
    expect(leadConversionForm).not.toContain("<div className=\"form-actions\">");
    expect(contractWorkflowPanel).toContain("compact");
  });

  it("shares activity due-date shortcuts across create and edit forms", () => {
    expect(activityForm).toContain("ActivityDueDateShortcuts");
    expect(activityEditForm).toContain("ActivityDueDateShortcuts");
    expect(activityForm).toContain("ActivityDueDateHint");
    expect(activityEditForm).toContain("ActivityDueDateHint");
    expect(activityFormGuidance).toContain("export function ActivityDueDateHint");
    expect(activityFormGuidance).toContain("Used for work-queue order, not calendar reminders.");
    expect(activityDueDateShortcuts).toContain("export function ActivityDueDateShortcuts");
    expect(activityDueDateShortcuts).toContain("import { ActionGroup }");
    expect(activityDueDateShortcuts).toContain('<ActionGroup className="filter-actions due-shortcuts" label={shortcutGroupLabel}>');
    expect(activityDueDateShortcuts).toContain("aria-label={`Set due date to ${shortcut.label.toLowerCase()}`}");
    expect(activityDueDateShortcuts).toContain("title={`Set due date to ${shortcut.label.toLowerCase()}`}");
    expect(activityDueDateShortcuts).toContain("Today");
    expect(activityDueDateShortcuts).toContain("Tomorrow");
    expect(activityDueDateShortcuts).toContain("Next week");
    expect(activityDueDateShortcuts).toContain("formatDateInputOffset");
  });

  it("uses the shared action bar on settings and workflow admin forms", () => {
    for (const form of [accountSettingsForm, workspaceInviteForm, createWorkspaceForm, emailTemplatesPanel, contractWorkflowPanel]) {
      expect(form).toContain("FormActionBar");
    }

    expect(accountSettingsForm).toContain("submitLabel=\"Save display name\"");
    expect(workspaceInviteForm).toContain("submitLabel=\"Create invitation\"");
    expect(createWorkspaceForm).toContain("submitLabel=\"Create workspace\"");
    expect(emailTemplatesPanel).toContain("submitLabel=\"Create template\"");
    expect(emailTemplatesPanel).toContain("submitDisabled={!name.trim() || !subject.trim() || !body.trim()}");
    expect(contractWorkflowPanel).toContain("compact");
    expect(contractWorkflowPanel).toContain("disabledHintId={`contract-step-${item.label.toLowerCase()}-disabled-hint`}");
    expect(contractWorkflowPanel).toContain("submitDisabled={!canSave}");
    expect(contractWorkflowPanel).toContain("submitLabel={item.id ? \"Update step\" : \"Create step\"}");
    expect(accountSettingsForm).toContain("FormSuccessMessage");
    expect(workspaceInviteForm).toContain("FormSuccessMessage");
    expect(workspaceInviteForm).toContain("<FormSuccessMessage compact id=\"workspace-invite-message\">");
  });

  it("shares alert-style validation messages across CRM workflow forms", () => {
    expect(formErrorMessage).toContain("role=\"alert\"");
    expect(formErrorMessage).toContain("compact ? \"compact-error\" : null");

    for (const form of [
      accountSettingsForm,
      workspaceInviteForm,
      createWorkspaceForm,
      emailTemplatesPanel,
      importFormShared,
      dealStageMoveForm,
      dealCloseActions,
      dealLineItemsPanel,
      productCreateForm,
      customFieldDefinitionForm,
      manualEmailLogPanel,
      quoteAdjustmentsForm,
      quoteDealValueSyncAction,
      quoteDraftsPanel,
      quotePublicLinkControls,
      quoteStatusActions,
      contractWorkflowPanel
    ]) {
      expect(form).toContain("FormErrorMessage");
      expect(form).not.toContain("<div className=\"form-error\">{error}</div>");
      expect(form).not.toContain("<p className=\"form-error\">{error}</p>");
    }

    for (const compactAction of [activityCompleteButton, activityDeleteButton, noteDeleteButton, recordCustomFieldsForm]) {
      expect(compactAction).toContain("<FormErrorMessage compact>{error}</FormErrorMessage>");
      expect(compactAction).not.toContain("form-error compact-error");
    }
  });
});
