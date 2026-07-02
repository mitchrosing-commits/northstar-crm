import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getNextOpenActivity } from "@/components/record-next-activity-summary";
import { recordSubtitle } from "@/lib/record-subtitle";

const service = [
  readFileSync(join(process.cwd(), "lib/services/contact-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/organization-service.ts"), "utf8")
].join("\n");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const organizationPage = readFileSync(join(process.cwd(), "app/organizations/[organizationId]/page.tsx"), "utf8");
const contactsList = readFileSync(join(process.cwd(), "app/contacts/page.tsx"), "utf8");
const organizationsList = readFileSync(join(process.cwd(), "app/organizations/page.tsx"), "utf8");
const dealDetail = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const activityList = readFileSync(join(process.cwd(), "components/activity-list.tsx"), "utf8");
const recordNextActivitySummary = readFileSync(join(process.cwd(), "components/record-next-activity-summary.tsx"), "utf8");
const inlineEmptyStateText = readFileSync(join(process.cwd(), "components/inline-empty-state-text.tsx"), "utf8");
const relatedRecordsTable = readFileSync(join(process.cwd(), "components/related-records-table.tsx"), "utf8");
const tableScroll = readFileSync(join(process.cwd(), "components/table-scroll.tsx"), "utf8");
const personName = readFileSync(join(process.cwd(), "lib/person-name.ts"), "utf8");
const recordSubtitleSource = readFileSync(join(process.cwd(), "lib/record-subtitle.ts"), "utf8");

describe("contact and organization detail pages", () => {
  it("uses existing workspace-scoped person and organization services with related records", () => {
    expect(service).toContain("export async function getPerson");
    expect(service).toContain("export async function getOrganization");
    expect(service).toContain("deals: { where: { workspaceId: actor.workspaceId, ...activeWhere }");
    expect(service).toContain("activityAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("noteAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("entityType: \"Person\"");
    expect(service).toContain("entityType: \"Organization\"");
  });

  it("adds read-only detail pages with not-found handling", () => {
    expect(contactPage).toContain("getPerson(actor, personId)");
    expect(contactPage).toContain("notFound()");
    expect(contactPage).toContain("Linked Deals");
    expect(contactPage).toContain("countLabel: { singular: \"deal\", plural: \"deals\" }");
    expect(contactPage).toContain("activities: person.activities.length");
    expect(contactPage).toContain("customFields: customFields.length");
    expect(contactPage).toContain("notes: person.notes.length");
    expect(contactPage).toContain("timeline: timelineItems.length");
    expect(contactPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(contactPage).toContain('import { recordSubtitle } from "@/lib/record-subtitle"');
    expect(contactPage).toContain('const personName = formatPersonName(person) ?? person.email ?? "Unnamed contact"');
    expect(contactPage).toContain("subtitle={recordSubtitle([person.organization?.name, person.email, person.owner?.name ?? person.owner?.email])}");
    expect(contactPage).not.toContain('subtitle={[person.organization?.name, person.email, person.owner?.name ?? person.owner?.email].filter(Boolean).join(" · ")}');
    expect(contactPage).not.toContain("function formatPersonName");
    expect(personName).toContain("export function formatPersonName");
    expect(contactPage).toContain("{ label: \"Owner\", value: person.owner?.name ?? person.owner?.email ?? \"Unassigned\", tone: person.owner ? \"default\" : \"muted\" }");
    expect(contactPage).toContain('{ emptyLabel: "No email", label: "Email", value: person.email }');
    expect(contactPage).toContain('{ emptyLabel: "No phone", label: "Phone", value: person.phone }');
    expect(contactPage).toContain('emptyLabel: "No organization"');
    expect(contactPage).toContain('import { InlineEmptyStateText } from "@/components/inline-empty-state-text"');
    expect(contactPage).toContain("<InlineEmptyStateText>No organization linked</InlineEmptyStateText>");
    expect(contactPage).not.toContain('"Not linked"');
    expect(contactPage).not.toContain('person.email ?? "None"');
    expect(contactPage).not.toContain('person.phone ?? "None"');
    expect(contactPage).toContain("id=\"related-deals\"");
    expect(contactPage).toContain("RelatedRecordsPanel");
    expect(contactPage).toContain("count={person.deals.length}");
    expect(contactPage).toContain("RelatedDealsTable");
    expect(contactPage).toContain("href={`/deals/new?personId=${person.id}` as Route}");
    expect(contactPage).toContain("Create linked deal");
    expect(contactPage).toContain("No deals are linked to this contact.");
    expect(contactPage).toContain("AuditHistoryPanel");
    expect(organizationPage).toContain("getOrganization(actor, organizationId)");
    expect(organizationPage).toContain('import { recordSubtitle } from "@/lib/record-subtitle"');
    expect(organizationPage).toContain("notFound()");
    expect(organizationPage).toContain("subtitle={recordSubtitle([organization.domain, organization.owner?.name ?? organization.owner?.email])}");
    expect(organizationPage).not.toContain('subtitle={[organization.domain, organization.owner?.name ?? organization.owner?.email].filter(Boolean).join(" · ")}');
    expect(organizationPage).toContain("href: \"#related-people\" as Route");
    expect(organizationPage).toContain("label: \"People\"");
    expect(organizationPage).toContain("count: organization.people.length");
    expect(organizationPage).toContain("href: \"#related-deals\" as Route");
    expect(organizationPage).toContain("label: \"Deals\"");
    expect(organizationPage).toContain("count: organization.deals.length");
    expect(organizationPage).toContain("countLabel: { singular: \"person\", plural: \"people\" }");
    expect(organizationPage).toContain("countLabel: { singular: \"deal\", plural: \"deals\" }");
    expect(organizationPage).toContain("activities: organization.activities.length");
    expect(organizationPage).toContain("customFields: customFields.length");
    expect(organizationPage).toContain("notes: organization.notes.length");
    expect(organizationPage).toContain("timeline: timelineItems.length");
    expect(organizationPage).toContain(
      "{ label: \"Owner\", value: organization.owner?.name ?? organization.owner?.email ?? \"Unassigned\", tone: organization.owner ? \"default\" : \"muted\" }"
    );
    expect(organizationPage).toContain('{ emptyLabel: "No domain", label: "Domain", value: organization.domain }');
    expect(organizationPage).not.toContain('organization.domain ?? "None"');
    expect(organizationPage).toContain("id=\"related-people\"");
    expect(organizationPage).toContain("id=\"related-deals\"");
    expect(organizationPage).toContain("RelatedRecordsPanel");
    expect(organizationPage).toContain("count={organization.people.length}");
    expect(organizationPage).toContain("count={organization.deals.length}");
    expect(organizationPage).toContain("RelatedPeopleTable");
    expect(organizationPage).toContain("RelatedDealsTable");
    expect(organizationPage).toContain("href={`/contacts/new?organizationId=${organization.id}` as Route}");
    expect(organizationPage).toContain("href={`/deals/new?organizationId=${organization.id}` as Route}");
    expect(organizationPage).toContain("const addPersonActionLabel = `Add person linked to ${organization.name}`");
    expect(organizationPage).toContain("aria-label={addPersonActionLabel}");
    expect(organizationPage).toContain("title={addPersonActionLabel}");
    expect(organizationPage).toContain("const createLinkedDealActionLabel = `Create deal linked to ${organization.name}`");
    expect(organizationPage).toContain("aria-label={createLinkedDealActionLabel}");
    expect(organizationPage).toContain("title={createLinkedDealActionLabel}");
    expect(contactPage).toContain("const createLinkedDealActionLabel = `Create deal linked to ${personName}`");
    expect(contactPage).toContain("aria-label={createLinkedDealActionLabel}");
    expect(contactPage).toContain("title={createLinkedDealActionLabel}");
    expect(organizationPage).toContain("Add person");
    expect(organizationPage).toContain("Create linked deal");
    expect(organizationPage).toContain("No people are linked to this organization.");
    expect(organizationPage).toContain("AuditHistoryPanel");
  });

  it("uses shared record subtitles for stable page-header context", () => {
    expect(recordSubtitleSource).toContain("export function recordSubtitle");
    expect(recordSubtitleSource).toContain('.join(" · ")');
    expect(recordSubtitle([" Acme ", null, undefined, false, "Owner"])).toBe("Acme · Owner");
    expect(recordSubtitle([null, undefined, false])).toBeUndefined();
  });

  it("uses shared related-record tables with list hierarchy and mobile scrolling", () => {
    expect(relatedRecordsTable).toContain("export function RelatedDealsTable");
    expect(relatedRecordsTable).toContain("export function RelatedPeopleTable");
    expect(relatedRecordsTable).toContain("export function RelatedRecordsPanel");
    expect(relatedRecordsTable).toContain("EmptyState");
    expect(relatedRecordsTable).toContain("import { useId, type ReactNode } from \"react\"");
    expect(relatedRecordsTable).toContain("const generatedTitleId = useId()");
    expect(relatedRecordsTable).toContain("const titleId = id ? `${id}-title` : `${generatedTitleId}-related-records-title`");
    expect(relatedRecordsTable).toContain("aria-labelledby={titleId}");
    expect(relatedRecordsTable).toContain("emptyAction?: ReactNode");
    expect(relatedRecordsTable).toContain("actions={emptyAction}");
    expect(relatedRecordsTable).toContain("empty-state-compact empty-state-panel");
    expect(relatedRecordsTable).toContain("title={emptyMessage}");
    expect(relatedRecordsTable).toContain("PanelTitleRow");
    expect(relatedRecordsTable).toContain("count-badge");
    expect(relatedRecordsTable).toContain(
      "const countLabel =\n    typeof count === \"number\" ? `${title} related record count: ${count}` : undefined;",
    );
    expect(relatedRecordsTable).toContain("aria-label={countLabel}");
    expect(relatedRecordsTable).toContain("title={countLabel}");
    expect(relatedRecordsTable).toContain("actionsLabel={`${title} related record count`}");
    expect(relatedRecordsTable).toContain("titleId={titleId}");
    expect(relatedRecordsTable).toContain("TableScroll");
    expect(tableScroll).toContain("className={[\"table-scroll\", className].filter(Boolean).join(\" \")}");
    expect(tableScroll).toContain("Use horizontal scrolling or keyboard arrow keys while focused to review every column.");
    expect(tableScroll).toContain("{resolvedHint}");
    expect(relatedRecordsTable).toContain("aria-label=\"Related deals table\"");
    expect(relatedRecordsTable).toContain("aria-label=\"Related people table\"");
    expect(relatedRecordsTable).toContain("className=\"table crm-list-table\"");
    expect(relatedRecordsTable).toContain("data-label=\"Deal\"");
    expect(relatedRecordsTable).toContain("data-label=\"Value\"");
    expect(relatedRecordsTable).toContain("data-label=\"Status\"");
    expect(relatedRecordsTable).toContain("data-label=\"Expected close\"");
    expect(relatedRecordsTable).toContain("data-label=\"Name\"");
    expect(relatedRecordsTable).toContain("data-label=\"Email\"");
    expect(relatedRecordsTable).toContain("data-label=\"Phone\"");
    expect(relatedRecordsTable).toContain("data-label=\"Actions\"");
    expect(relatedRecordsTable).toContain("TablePrimaryRecordCell");
    expect(relatedRecordsTable).toContain("TableOptionalValueCell");
    expect(relatedRecordsTable).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(relatedRecordsTable).toContain('const personName = formatPersonName(person) ?? "Unnamed contact"');
    expect(relatedRecordsTable).not.toContain("function formatPersonName");
    expect(personName).toContain("export function formatPersonName");
    expect(relatedRecordsTable).toContain("const openDealLabel = `Open related deal ${deal.title}`");
    expect(relatedRecordsTable).toContain("linkLabel={openDealLabel}");
    expect(relatedRecordsTable).toContain("const openContactLabel = `Open related contact ${personName}`");
    expect(relatedRecordsTable).toContain("linkLabel={openContactLabel}");
    expect(relatedRecordsTable).toContain("StatusBadge");
    expect(relatedRecordsTable).toContain("formatMoney(deal.valueCents, deal.currency)");
    expect(relatedRecordsTable).toContain('secondary={deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : "No expected close"}');
    expect(relatedRecordsTable).toContain('emptyLabel="No expected close"');
    expect(relatedRecordsTable).toContain("value={deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : null}");
    expect(relatedRecordsTable).toContain("No email recorded");
    expect(relatedRecordsTable).toContain('<TableOptionalValueCell emptyLabel="No email" value={person.email} />');
    expect(relatedRecordsTable).toContain('<TableOptionalValueCell emptyLabel="No phone" value={person.phone} />');
    expect(relatedRecordsTable).toContain("ListRowActions");
    expect(relatedRecordsTable).toContain("buildActivityFollowUpHref");
    expect(relatedRecordsTable).toContain("className=\"table-actions-cell\"");
    expect(relatedRecordsTable).toContain('label: "Open deal"');
    expect(relatedRecordsTable).toContain('label: "Open contact"');
    expect(relatedRecordsTable).not.toContain('label: "Open", ariaLabel: `Open deal');
    expect(relatedRecordsTable).not.toContain('label: "Open", ariaLabel: `Open contact');
    expect(relatedRecordsTable).toContain("label: \"Add activity\"");
    expect(relatedRecordsTable).toContain("related: { type: \"deal\", id: deal.id }");
    expect(relatedRecordsTable).toContain("related: { type: \"person\", id: person.id }");
    expect(relatedRecordsTable).toContain("returnTo: `/deals/${deal.id}`");
    expect(relatedRecordsTable).toContain("returnTo: `/contacts/${person.id}`");
  });

  it("links people and organizations from existing CRM surfaces", () => {
    expect(contactsList).toContain("href={`/contacts/${person.id}`}");
    expect(contactsList).toContain("TableLinkedRecordCell");
    expect(contactsList).toContain("href={person.organization ? `/organizations/${person.organization.id}` : undefined}");
    expect(organizationsList).toContain("href={`/organizations/${organization.id}`}");
    expect(dealDetail).toContain("href={`/contacts/${deal.person.id}`}");
    expect(dealDetail).toContain("href={`/organizations/${deal.organization.id}`}");
    expect(activityList).toContain("href: `/contacts/${activity.person.id}`");
    expect(activityList).toContain("type: \"Contact\"");
    expect(activityList).toContain("href: `/organizations/${activity.organization.id}`");
    expect(activityList).toContain("type: \"Organization\"");
    expect(activityList).toContain("href={link.href as Route}");
  });

  it("surfaces next open follow-ups in account-style record summaries", () => {
    expect(recordNextActivitySummary).toContain("export function RecordNextActivitySummary");
    expect(recordNextActivitySummary).toContain("export function getNextOpenActivity");
    expect(recordNextActivitySummary).toContain("href={`/activities/${activity.id}/edit` as Route}");
    expect(recordNextActivitySummary).toContain("const activityLabel = `Open next follow-up ${activity.title}`");
    expect(recordNextActivitySummary).toContain("aria-label={activityLabel}");
    expect(recordNextActivitySummary).toContain("title={activityLabel}");
    expect(recordNextActivitySummary).toContain("ActivityDueBadge");
    expect(recordNextActivitySummary).toContain("No open follow-up");
    expect(recordNextActivitySummary).toContain("InlineEmptyStateText");
    expect(recordNextActivitySummary).toContain("<InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>");
    expect(recordNextActivitySummary).not.toContain('<span className="muted">{emptyLabel}</span>');
    expect(inlineEmptyStateText).toContain("inline-empty-state-text");
    expect(recordNextActivitySummary).toContain("getNextActivityForRecord");
    expect(contactPage).toContain("getNextOpenActivity(person.activities)");
    expect(contactPage).toContain("RecordNextActivitySummary activity={nextActivity}");
    expect(contactPage).toContain("Next follow-up");
    expect(organizationPage).toContain("getNextOpenActivity(organization.activities)");
    expect(organizationPage).toContain("RecordNextActivitySummary activity={nextActivity}");
    expect(organizationPage).toContain("Next follow-up");

    expect(
      getNextOpenActivity([
        {
          id: "completed_first",
          title: "Completed earlier",
          dueAt: "2029-01-01T10:00:00.000Z",
          completedAt: "2029-01-01T11:00:00.000Z"
        },
        {
          id: "no_due",
          title: "No due date",
          dueAt: null,
          completedAt: null
        },
        {
          id: "due_later",
          title: "Later",
          dueAt: "2030-01-03T10:00:00.000Z",
          completedAt: null
        },
        {
          id: "due_first",
          title: "First",
          dueAt: "2030-01-02T10:00:00.000Z",
          completedAt: null
        }
      ])
    ).toMatchObject({ id: "due_first" });
  });
});
