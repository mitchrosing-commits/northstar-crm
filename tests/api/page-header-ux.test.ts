import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pageHeader = readFileSync(
  join(process.cwd(), "components/page-header.tsx"),
  "utf8",
);
const actionGroup = readFileSync(
  join(process.cwd(), "components/action-group.tsx"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const activitiesPage = readFileSync(
  join(process.cwd(), "app/activities/page.tsx"),
  "utf8",
);
const contactsPage = readFileSync(
  join(process.cwd(), "app/contacts/page.tsx"),
  "utf8",
);
const contactDetailPage = readFileSync(
  join(process.cwd(), "app/contacts/[personId]/page.tsx"),
  "utf8",
);
const customFieldsPage = readFileSync(
  join(process.cwd(), "app/custom-fields/page.tsx"),
  "utf8",
);
const dashboardPage = readFileSync(
  join(process.cwd(), "app/dashboard/page.tsx"),
  "utf8",
);
const dealDetailPage = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/page.tsx"),
  "utf8",
);
const dealsPage = readFileSync(
  join(process.cwd(), "app/deals/page.tsx"),
  "utf8",
);
const developerApiPage = readFileSync(
  join(process.cwd(), "app/settings/developer-api/page.tsx"),
  "utf8",
);
const emailPage = readFileSync(
  join(process.cwd(), "app/email/page.tsx"),
  "utf8",
);
const importExportPage = readFileSync(
  join(process.cwd(), "app/settings/import-export/page.tsx"),
  "utf8",
);
const listPageHeaderActions = readFileSync(
  join(process.cwd(), "components/list-page-header-actions.tsx"),
  "utf8",
);
const listResourceLabels = readFileSync(
  join(process.cwd(), "lib/list-resource-labels.ts"),
  "utf8",
);
const leadDetailPage = readFileSync(
  join(process.cwd(), "app/leads/[leadId]/page.tsx"),
  "utf8",
);
const leadsPage = readFileSync(
  join(process.cwd(), "app/leads/page.tsx"),
  "utf8",
);
const organizationDetailPage = readFileSync(
  join(process.cwd(), "app/organizations/[organizationId]/page.tsx"),
  "utf8",
);
const organizationsPage = readFileSync(
  join(process.cwd(), "app/organizations/page.tsx"),
  "utf8",
);
const productsPage = readFileSync(
  join(process.cwd(), "app/products/page.tsx"),
  "utf8",
);
const pipelinePage = readFileSync(
  join(process.cwd(), "app/pipeline/page.tsx"),
  "utf8",
);
const quoteDetailPage = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/page.tsx"),
  "utf8",
);
const recordHeaderActions = readFileSync(
  join(process.cwd(), "components/record-header-actions.tsx"),
  "utf8",
);
const reportsPage = readFileSync(
  join(process.cwd(), "app/reports/page.tsx"),
  "utf8",
);
const searchPage = readFileSync(
  join(process.cwd(), "app/search/page.tsx"),
  "utf8",
);
const settingsPage = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);

describe("shared page header UX", () => {
  it("centralizes repeated page header structure for low-risk list and command surfaces", () => {
    expect(pageHeader).toContain("export function PageHeader");
    expect(pageHeader).toContain(
      'import { useId, type ReactNode } from "react"',
    );
    expect(pageHeader).toContain('className="page-header"');
    expect(pageHeader).toContain("titleId?: string");
    expect(pageHeader).toContain("const generatedTitleId = useId()");
    expect(pageHeader).toContain(
      "const resolvedTitleId = titleId ?? `${generatedTitleId}-page-header-title`",
    );
    expect(pageHeader).toContain(
      "const subtitleId = subtitle ? `${resolvedTitleId}-subtitle` : undefined",
    );
    expect(pageHeader).toContain("aria-labelledby={resolvedTitleId}");
    expect(pageHeader).toContain("aria-describedby={subtitleId}");
    expect(pageHeader).toContain('className="page-header-copy"');
    expect(pageHeader).toContain('className="page-kicker"');
    expect(pageHeader).toContain('className="page-title"');
    expect(pageHeader).toContain("id={resolvedTitleId}");
    expect(pageHeader).toContain('className="page-subtitle"');
    expect(pageHeader).toContain("id={subtitleId}");
    expect(pageHeader).toContain('actionsLabel = "Page actions"');
    expect(pageHeader).toContain("import { ActionGroup }");
    expect(pageHeader).toContain('className="header-actions"');
    expect(pageHeader).toContain("const resolvedActionsLabel");
    expect(pageHeader).toContain(
      'actionsLabel === "Page actions" && typeof title === "string" ? `${title} actions` : actionsLabel',
    );
    expect(pageHeader).toContain(
      '<ActionGroup className="header-actions" label={resolvedActionsLabel}>',
    );
    expect(actionGroup).toContain("export function ActionGroup");
    expect(actionGroup).toContain("aria-label={label}");
    expect(actionGroup).toContain('role="group"');
    expect(actionGroup).toContain("title={label}");
    expect(globalStyles).toContain(".page-header-copy");
    expect(globalStyles).toContain("min-width: 0");
    expect(globalStyles).toContain("overflow-wrap: anywhere");
    expect(globalStyles).not.toContain(".panel-intro-copy");

    for (const page of [
      activitiesPage,
      contactsPage,
      contactDetailPage,
      customFieldsPage,
      dashboardPage,
      dealDetailPage,
      dealsPage,
      developerApiPage,
      importExportPage,
      leadDetailPage,
      leadsPage,
      organizationDetailPage,
      organizationsPage,
      productsPage,
      pipelinePage,
      quoteDetailPage,
      reportsPage,
      settingsPage,
      searchPage,
    ]) {
      expect(page).toContain("PageHeader");
      expect(page).not.toContain('<header className="page-header">');
    }
    expect(emailPage).toContain("EmailClientHeader");
    expect(emailPage).toContain("className={");
    expect(emailPage).toContain("selectedThreadWasRequested");
    expect(emailPage).toContain(
      '"email-client-shell email-client-detail-shell"',
    );
    expect(emailPage).not.toContain('<header className="page-header">');
  });

  it("preserves existing product, pipeline, and search header copy and actions", () => {
    expect(productsPage).toContain('eyebrow="Catalog"');
    expect(productsPage).toContain('title="Products"');
    expect(productsPage).toContain(
      'subtitle="Manage reusable pricing inputs for deal line items without rewriting historical quotes."',
    );
    expect(productsPage).toContain("Export products");

    expect(pipelinePage).toContain('eyebrow="Pipeline"');
    expect(pipelinePage).toContain('title={pipeline?.name ?? "Pipeline"}');
    expect(pipelinePage).toContain(
      'subtitle={pipeline ? "Open a deal to update stage, activities, notes, and quotes, or use Move on a card." : undefined}',
    );
    expect(pipelinePage).toContain("ListPageHeaderActions");
    expect(pipelinePage).toContain('resource="deals"');

    expect(searchPage).toContain('eyebrow="Workspace search"');
    expect(searchPage).toContain('title="Search"');
    expect(searchPage).toContain("ListViewStatus active={hasQuery}");
    expect(searchPage).toContain(
      "Find records, open filtered lists, and jump into common CRM actions.",
    );
  });

  it("keeps core list status, export, and primary actions in the shared header", () => {
    expect(listPageHeaderActions).toContain(
      "export function ListPageHeaderActions",
    );
    expect(listPageHeaderActions).toContain(
      'className="list-page-header-actions"',
    );
    expect(listPageHeaderActions).toContain(
      "const listActionsLabel = `${listResourceSingularLabel(resource)} list actions`",
    );
    expect(listPageHeaderActions).toContain("import { ActionGroup }");
    expect(listPageHeaderActions).toContain(
      '<ActionGroup className="list-page-header-actions" label={listActionsLabel}>',
    );
    expect(listPageHeaderActions).toContain("listResourceSingularLabel");
    expect(listPageHeaderActions).toContain(
      "const createActionLabel = listResourceCreateActionLabel(resource, createLabel)",
    );
    expect(listPageHeaderActions).toContain("listResourceCreateActionLabel");
    expect(listPageHeaderActions).toContain("aria-label={createActionLabel}");
    expect(listPageHeaderActions).toContain("title={createActionLabel}");
    expect(listPageHeaderActions).toContain("importHref?: Route");
    expect(listPageHeaderActions).toContain('importLabel = "Import CSV"');
    expect(listPageHeaderActions).toContain("aria-label={importActionLabel}");
    expect(listPageHeaderActions).toContain("title={importActionLabel}");
    expect(
      listPageHeaderActions.indexOf("aria-label={createActionLabel}"),
    ).toBeLessThan(
      listPageHeaderActions.indexOf("aria-label={importActionLabel}"),
    );
    expect(
      listPageHeaderActions.indexOf("aria-label={importActionLabel}"),
    ).toBeLessThan(listPageHeaderActions.indexOf("<ListExportLink"));
    expect(listResourceLabels).toContain('createNoun: "an organization"');
    expect(listResourceLabels).toContain('createNoun: "an activity"');
    expect(listResourceLabels).toContain(
      "`${createLabel}: create ${createNoun}`",
    );
    expect(listPageHeaderActions).toContain("<ListExportLink");
    expect(listPageHeaderActions).toContain('className="button-primary"');
    expect(listPageHeaderActions).toContain('className="button-secondary"');
    expect(globalStyles).toContain(".list-page-header-actions");
    expect(globalStyles).toContain("justify-content: flex-end");
    expect(globalStyles).toContain("justify-content: flex-start");
    expect(globalStyles).toContain(
      ".list-page-header-actions .list-export-action",
    );

    expect(dealsPage).toContain('eyebrow="Opportunities"');
    expect(dealsPage).toContain('title="Deals"');
    expect(dealsPage).toContain(
      "Track pipeline value, next activity, ownership, and customer relationships in one list.",
    );
    expect(dealsPage).toContain("ListViewStatusForState");
    expect(dealsPage).toContain('label="Filtered deals view active"');
    expect(dealsPage).toContain('resetHref="/deals"');
    expect(dealsPage).toContain("matchingCount={dealPage.total}");
    expect(dealsPage).toContain('createHref="/deals/new"');
    expect(dealsPage).toContain('createLabel="New deal"');
    expect(pipelinePage).toContain("matchingCount={dealExportCount}");

    expect(contactsPage).toContain('eyebrow="People"');
    expect(contactsPage).toContain('title="Contacts"');
    expect(contactsPage).toContain(
      "People linked to deals, organizations, activities, email, and notes.",
    );
    expect(contactsPage).toContain("ListViewStatusForState");
    expect(contactsPage).toContain('label="Filtered contacts view active"');
    expect(contactsPage).toContain('resetHref="/contacts"');
    expect(contactsPage).toContain("matchingCount={peoplePage.total}");
    expect(contactsPage).toContain('createHref="/contacts/new"');
    expect(contactsPage).toContain('createLabel="New contact"');

    expect(organizationsPage).toContain('eyebrow="Companies"');
    expect(organizationsPage).toContain('title="Organizations"');
    expect(organizationsPage).toContain(
      "Accounts that group people, deals, activities, notes, and history.",
    );
    expect(organizationsPage).toContain("ListViewStatusForState");
    expect(organizationsPage).toContain(
      'label="Filtered organizations view active"',
    );
    expect(organizationsPage).toContain('resetHref="/organizations"');
    expect(organizationsPage).toContain(
      "matchingCount={organizationPage.total}",
    );
    expect(organizationsPage).toContain('createHref="/organizations/new"');
    expect(organizationsPage).toContain('createLabel="New organization"');

    expect(leadsPage).toContain('eyebrow="Prospects"');
    expect(leadsPage).toContain('title="Leads"');
    expect(leadsPage).toContain(
      "Early opportunities before they become pipeline deals.",
    );
    expect(leadsPage).toContain("ListViewStatusForState");
    expect(leadsPage).toContain('label="Filtered leads view active"');
    expect(leadsPage).toContain('resetHref="/leads"');
    expect(leadsPage).toContain("matchingCount={leadPage.total}");
    expect(leadsPage).toContain('createHref="/leads/new"');
    expect(leadsPage).toContain('createLabel="New lead"');

    expect(activitiesPage).toContain('eyebrow="Work queue"');
    expect(activitiesPage).toContain('title="Activities"');
    expect(activitiesPage).toContain(
      "Calls, emails, meetings, and tasks that keep CRM records moving.",
    );
    expect(activitiesPage).toContain(
      "ListViewStatus active={hasActiveFilters}",
    );
    expect(activitiesPage).toContain('label="Filtered activities view active"');
    expect(activitiesPage).toContain('resetHref="/activities"');
    expect(activitiesPage).toContain('legend="Activity filters"');
    expect(activitiesPage).toContain("matchingCount={activityPage.total}");
    expect(activitiesPage).toContain('createHref="/activities/new"');
    expect(activitiesPage).toContain('createLabel="New activity"');
  });

  it("keeps command and admin page actions in the shared header", () => {
    expect(dashboardPage).toContain('eyebrow="Workspace"');
    expect(dashboardPage).toContain('title="Dashboard"');
    expect(dashboardPage).toContain(
      "A command center for pipeline health, urgent follow-ups, and recent customer work.",
    );
    expect(dashboardPage).toContain('href="/pipeline"');
    expect(dashboardPage).toContain('href="/deals/new"');

    expect(reportsPage).toContain('eyebrow="Deal Reporting v1"');
    expect(reportsPage).toContain('title="Reports"');
    expect(reportsPage).toContain(
      "Operating metrics for pipeline value, activity coverage, quote movement, and forecast health.",
    );
    expect(reportsPage).toContain("href={dealsHref}");

    expect(emailPage).toContain("function EmailClientHeader");
    expect(emailPage).toContain("<h1>Inbox</h1>");
    expect(emailPage).toContain("Communication");
    expect(emailPage).toContain("Showing latest");
    expect(emailPage).toContain('href="/api/email-connections/google/connect"');

    expect(settingsPage).toContain('eyebrow="Workspace"');
    expect(settingsPage).toContain('title="Settings"');
    expect(settingsPage).toContain(
      "Account, workspace, email, pipeline, imports, and admin controls.",
    );

    expect(customFieldsPage).toContain('eyebrow="Settings"');
    expect(customFieldsPage).toContain('title="Custom Fields"');
    expect(customFieldsPage).toContain(
      "Define focused workspace fields for deals, contacts, organizations, and leads.",
    );
    expect(customFieldsPage).toContain('href="#new-custom-field"');

    expect(developerApiPage).toContain('title="Developer / API"');
    expect(developerApiPage).toContain(
      "Review workspace-scoped REST coverage, export endpoints, and integration guardrails.",
    );
    expect(developerApiPage).toContain('href="/settings"');

    expect(importExportPage).toContain('title="Import / Export"');
    expect(importExportPage).toContain(
      "Move CRM data safely with filter-aware exports and preview-first CSV imports.",
    );
    expect(importExportPage).toContain('href="/settings"');
  });

  it("keeps record detail status and navigation actions in the shared header", () => {
    expect(recordHeaderActions).toContain(
      "export function RecordHeaderActions",
    );
    expect(recordHeaderActions).toContain("leadingActions");
    expect(recordHeaderActions).toContain("addHref");
    expect(recordHeaderActions).toContain(
      'addLockedLabel = "Follow-up locked"',
    );
    expect(recordHeaderActions).toContain("backHref");
    expect(recordHeaderActions).toContain("customFieldsHref");
    expect(recordHeaderActions).toContain(
      'customFieldsLabel = "Custom fields"',
    );
    expect(recordHeaderActions).toContain("editHref");
    expect(recordHeaderActions).toContain("noteHref");
    expect(recordHeaderActions).toContain('noteLockedLabel = "Notes locked"');
    expect(recordHeaderActions).toContain('noteLabel = "Add note"');
    expect(recordHeaderActions).toContain("recordTitle?: string");
    expect(recordHeaderActions).toContain("recordTitle");
    expect(recordHeaderActions).toContain("addHref && locked");
    expect(recordHeaderActions).toContain("noteHref && locked");
    expect(recordHeaderActions).toContain(
      "const addActionLabel = recordActionLabel(addLabel, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      "const noteActionLabel = recordActionLabel(noteLabel, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      "const customFieldsActionLabel = recordActionLabel(customFieldsLabel, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      "const backActionLabel = recordBackActionLabel(backLabel)",
    );
    expect(recordHeaderActions).toContain(
      "const editActionLabel = recordActionLabel(editLabel, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      "const addLockedActionLabel = lockedRecordActionLabel(addLockedLabel, lockedLabel, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      "const noteLockedActionLabel = lockedRecordActionLabel(noteLockedLabel, lockedLabel, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      "const editLockedActionLabel = lockedRecordActionLabel(editLabel, lockedLabel, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      'const actionsLabel = recordTitle?.trim() ? `${recordTitle.trim()} workspace actions` : "Record workspace actions"',
    );
    expect(recordHeaderActions).toContain("import { ActionGroup }");
    expect(recordHeaderActions).toContain(
      '<ActionGroup className="record-header-actions" label={actionsLabel}>',
    );
    expect(recordHeaderActions).toContain("aria-label={addLockedActionLabel}");
    expect(recordHeaderActions).toContain("aria-label={noteLockedActionLabel}");
    expect(recordHeaderActions).toContain("aria-label={addActionLabel}");
    expect(recordHeaderActions).toContain("aria-label={noteActionLabel}");
    expect(recordHeaderActions).toContain(
      "aria-label={customFieldsActionLabel}",
    );
    expect(recordHeaderActions).toContain("aria-label={backActionLabel}");
    expect(recordHeaderActions).toContain("aria-label={editActionLabel}");
    expect(recordHeaderActions).toContain("title={addActionLabel}");
    expect(recordHeaderActions).toContain("title={noteActionLabel}");
    expect(recordHeaderActions).toContain("title={customFieldsActionLabel}");
    expect(recordHeaderActions).toContain("title={backActionLabel}");
    expect(recordHeaderActions).toContain("title={editActionLabel}");
    expect(recordHeaderActions).toContain("title={addLockedActionLabel}");
    expect(recordHeaderActions).toContain("title={noteLockedActionLabel}");
    expect(recordHeaderActions).toContain("title={editLockedActionLabel}");
    expect(recordHeaderActions).not.toContain(
      "aria-label={`Edit unavailable: ${lockedLabel}`}",
    );
    expect(recordHeaderActions).toContain('lockedLabel = "Editing locked"');
    expect(recordHeaderActions).toContain('className="button-secondary"');
    expect(recordHeaderActions).toContain('className="button-primary"');
    expect(globalStyles).toContain(".record-header-actions");
    expect(globalStyles).toContain("justify-content: flex-end;");
    expect(recordHeaderActions).toContain("function recordActionLabel");
    expect(recordHeaderActions).toContain(
      "const trimmedTitle = recordTitle?.trim()",
    );
    expect(recordHeaderActions).toContain(
      "return trimmedTitle ? `${label}: ${trimmedTitle}` : `Record action: ${label}`",
    );
    expect(recordHeaderActions).toContain("function lockedRecordActionLabel");
    expect(recordHeaderActions).toContain(
      "const actionLabel = recordActionLabel(label, recordTitle)",
    );
    expect(recordHeaderActions).toContain(
      "return `${actionLabel}: ${lockedLabel}`",
    );
    expect(recordHeaderActions).toContain("function recordBackActionLabel");
    expect(recordHeaderActions).toContain("const trimmedLabel = label.trim()");
    expect(recordHeaderActions).toContain(
      "return /^back\\b/i.test(trimmedLabel) ? trimmedLabel : `Back to ${trimmedLabel}`",
    );

    expect(dealDetailPage).toContain('eyebrow="Deal"');
    expect(dealDetailPage).toContain("title={deal.title}");
    expect(dealDetailPage).toContain("RecordHeaderActions");
    expect(dealDetailPage).toContain("ContractWorkflowQuickLink alwaysShow");
    expect(dealDetailPage).toContain("StatusBadge status={deal.status}");
    expect(dealDetailPage).toContain('addHref={"#add-activity" as Route}');
    expect(dealDetailPage).toContain('addLockedLabel="Activity locked"');
    expect(dealDetailPage).toContain('noteHref={"#notes" as Route}');
    expect(dealDetailPage).toContain(
      'customFieldsHref={"#custom-fields" as Route}',
    );
    expect(dealDetailPage).toContain("lockedLabel={closedDealLockedLabel}");
    expect(dealDetailPage).toContain('noteLockedLabel="Notes locked"');
    expect(dealDetailPage).toContain("recordTitle={deal.title}");
    expect(dealDetailPage).toContain('backHref="/deals"');
    expect(dealDetailPage).toContain('backLabel="Back to deals"');
    expect(dealDetailPage).toContain(
      'editHref={deal.status === "OPEN" ? (`/deals/${deal.id}/edit` as Route) : undefined}',
    );
    expect(dealDetailPage).toContain('locked={deal.status !== "OPEN"}');

    expect(contactDetailPage).toContain('eyebrow="Contact"');
    expect(contactDetailPage).toContain("title={personName}");
    expect(contactDetailPage).toContain("RecordHeaderActions");
    expect(contactDetailPage).toContain('addHref={"#add-activity" as Route}');
    expect(contactDetailPage).toContain('noteHref={"#notes" as Route}');
    expect(contactDetailPage).toContain(
      'customFieldsHref={"#custom-fields" as Route}',
    );
    expect(contactDetailPage).toContain('backHref="/contacts"');
    expect(contactDetailPage).toContain('backLabel="Back to contacts"');
    expect(contactDetailPage).toContain(
      "editHref={`/contacts/${person.id}/edit` as Route}",
    );
    expect(contactDetailPage).toContain("recordTitle={personName}");

    expect(organizationDetailPage).toContain('eyebrow="Organization"');
    expect(organizationDetailPage).toContain("title={organization.name}");
    expect(organizationDetailPage).toContain("RecordHeaderActions");
    expect(organizationDetailPage).toContain(
      'addHref={"#add-activity" as Route}',
    );
    expect(organizationDetailPage).toContain('noteHref={"#notes" as Route}');
    expect(organizationDetailPage).toContain(
      'customFieldsHref={"#custom-fields" as Route}',
    );
    expect(organizationDetailPage).toContain('backHref="/organizations"');
    expect(organizationDetailPage).toContain(
      'backLabel="Back to organizations"',
    );
    expect(organizationDetailPage).toContain(
      "editHref={`/organizations/${organization.id}/edit` as Route}",
    );
    expect(organizationDetailPage).toContain("recordTitle={organization.name}");

    expect(leadDetailPage).toContain('eyebrow="Lead"');
    expect(leadDetailPage).toContain("title={lead.title}");
    expect(leadDetailPage).toContain("RecordHeaderActions");
    expect(leadDetailPage).toContain("StatusBadge status={lead.status}");
    expect(leadDetailPage).toContain('addHref={"#add-activity" as Route}');
    expect(leadDetailPage).toContain('addLockedLabel="Activity locked"');
    expect(leadDetailPage).toContain('noteHref={"#notes" as Route}');
    expect(leadDetailPage).toContain(
      'customFieldsHref={"#custom-fields" as Route}',
    );
    expect(leadDetailPage).toContain("lockedLabel={convertedLeadLockedLabel}");
    expect(leadDetailPage).toContain('noteLockedLabel="Notes locked"');
    expect(leadDetailPage).toContain("recordTitle={lead.title}");
    expect(leadDetailPage).toContain('backHref="/leads"');
    expect(leadDetailPage).toContain('backLabel="Back to leads"');
    expect(leadDetailPage).toContain(
      'editHref={lead.status !== "CONVERTED" ? (`/leads/${lead.id}/edit` as Route) : undefined}',
    );
    expect(leadDetailPage).toContain('locked={lead.status === "CONVERTED"}');

    expect(quoteDetailPage).toContain('eyebrow="Internal quote"');
    expect(quoteDetailPage).toContain("title={quote.number}");
    expect(quoteDetailPage).toContain('quote.status === "SENT"');
    expect(quoteDetailPage).toContain("Download PDF");
    expect(quoteDetailPage).toContain("Back to deal");
  });
});
