import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { personRelationshipProfile } from "@/lib/services/contact-service";
import { relationshipBriefUsageForField, relationshipBriefUsageItems } from "@/lib/relationship-brief-usage";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260706090000_person_relationship_intelligence/migration.sql"),
  "utf8"
);
const service = readFileSync(join(process.cwd(), "lib/services/contact-service.ts"), "utf8");
const validators = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const relationshipBriefPanel = readFileSync(join(process.cwd(), "components/relationship-brief-panel.tsx"), "utf8");
const openapi = readFileSync(join(process.cwd(), "docs/openapi.yaml"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("Relationship Intelligence for contact profiles", () => {
  it("stores a curated relationship brief directly on workspace-scoped contacts", () => {
    for (const field of [
      "relationshipPersonalContext",
      "relationshipCommunicationStyle",
      "relationshipBusinessConcerns",
      "relationshipFollowUpReminders",
      "relationshipInternalGuidance"
    ]) {
      expect(modelBlock("Person")).toMatch(new RegExp(`${field}\\s+String\\?`));
      expect(migration).toContain(`ADD COLUMN "${field}" TEXT`);
      expect(validators).toContain(`${field}: z.string().max(2000).optional().nullable()`);
      expect(service).toContain(field);
      expect(openapi).toContain(`${field}:`);
    }
    expect(service).toContain("export function personRelationshipProfile");
    expect(service).toContain("Relationship brief fields must be 2,000 characters or fewer.");
  });

  it("normalizes relationship profile context for future personalization services", () => {
    expect(
      personRelationshipProfile({
        relationshipBusinessConcerns: "Worried about switching costs",
        relationshipCommunicationStyle: "Prefers concise morning emails",
        relationshipFollowUpReminders: "Ask how the Colorado trip went",
        relationshipInternalGuidance: "Use naturally; do not over-personalize.",
        relationshipPersonalContext: "Rockies fan"
      })
    ).toEqual({
      personalContext: "Rockies fan",
      communicationStyle: "Prefers concise morning emails",
      businessConcerns: "Worried about switching costs",
      followUpReminders: "Ask how the Colorado trip went",
      internalGuidance: "Use naturally; do not over-personalize."
    });
  });

  it("maps relationship brief fields to deterministic usage guidance", () => {
    expect(relationshipBriefUsageItems()).toHaveLength(5);
    expect(relationshipBriefUsageItems().map((item) => item.label)).toEqual([
      "Personal context",
      "Communication style",
      "Business concerns",
      "Follow-up reminders",
      "Internal guidance"
    ]);
    expect(relationshipBriefUsageForField("relationshipPersonalContext")).toMatchObject({
      badges: ["Safe personalization"],
      category: "safe_personalization"
    });
    expect(relationshipBriefUsageForField("relationshipCommunicationStyle")).toMatchObject({
      badges: ["Use for tone"],
      category: "tone_context"
    });
    expect(relationshipBriefUsageForField("relationshipBusinessConcerns")).toMatchObject({
      badges: ["Use cautiously"],
      category: "use_cautiously"
    });
    expect(relationshipBriefUsageForField("relationshipFollowUpReminders")).toMatchObject({
      badges: ["Internal next step", "Do not mention directly"],
      category: "do_not_mention_directly"
    });
    expect(relationshipBriefUsageForField("relationshipInternalGuidance")).toMatchObject({
      badges: ["Internal only", "Do not mention directly"],
      category: "internal_only"
    });
  });

  it("renders and edits the Relationship Brief from the contact detail page", () => {
    expect(contactPage).toContain("RelationshipBriefPanel");
    expect(contactPage).toContain("type RelationshipBriefHistoryItem");
    expect(contactPage).toContain("const relationshipBrief = {");
    expect(contactPage).toContain("recentRelationshipBriefChanges(person.auditLogs, person.id)");
    expect(contactPage).toContain("type ParsedRelationshipBriefChange");
    expect(contactPage).toContain("relationshipBriefChangesFromMetadata");
    expect(contactPage).toContain("relationshipBriefHistorySourceLabel");
    expect(contactPage).toContain("relationshipBriefHistorySourceType");
    expect(contactPage).toContain("relationshipBriefHistoryFieldKey");
    expect(contactPage).toContain("relationshipBriefAcceptedFacts");
    expect(contactPage).toContain("change.target?.id && change.target.id !== personId");
    expect(contactPage).toContain("fieldKey: relationshipBriefHistoryFieldKey(change)");
    expect(contactPage).toContain("newValue: change.newValue ?? null");
    expect(contactPage).toContain('href: "#profile" as Route');
    expect(contactPage).toContain('label: "Profile"');
    expect(contactPage).toContain("href: \"#relationship-brief\" as Route");
    expect(contactPage.indexOf('id="profile"')).toBeLessThan(contactPage.indexOf("<RelatedRecordsPanel"));
    expect(contactPage.indexOf("<RelatedRecordsPanel")).toBeLessThan(contactPage.indexOf("<RecordActivitiesPanel"));
    expect(contactPage.indexOf("<RecordActivitiesPanel")).toBeLessThan(contactPage.indexOf("<RecordCustomFieldsPanel"));
    expect(contactPage).toContain("<RelationshipBriefPanel");
    expect(contactPage).toContain("recentChanges={relationshipBriefChanges}");
    expect(relationshipBriefPanel).toContain('title="Relationship Memory"');
    expect(relationshipBriefPanel).toContain('title="Source and Change History"');
    expect(relationshipBriefPanel).toContain("Curated relationship context for thoughtful follow-up.");
    expect(relationshipBriefPanel).toContain("Relationship Memory sensitivity guidance");
    expect(relationshipBriefPanel).toContain("relationship-memory-overview");
    expect(relationshipBriefPanel).toContain("relationship-memory-card-grid");
    expect(relationshipBriefPanel).toContain("relationship-memory-card-empty");
    expect(relationshipBriefPanel).toContain("relationship-memory-value");
    expect(relationshipBriefPanel).toContain("Add interests, hobbies, family context");
    expect(relationshipBriefPanel).toContain("Meeting Intelligence can suggest this from reviewed meetings");
    expect(relationshipBriefPanel).toContain("Last updated");
    expect(relationshipBriefPanel).toContain("manual updates");
    expect(relationshipBriefPanel).toContain("from Meeting Intelligence");
    expect(relationshipBriefPanel).toContain("Usage guidance");
    expect(relationshipBriefPanel).toContain("relationship-brief-usage-details");
    expect(relationshipBriefPanel).toContain("relationshipBriefUsageItems");
    expect(relationshipBriefPanel).toContain("customerFacingUse");
    expect(relationshipBriefPanel).toContain("AI/email usage");
    expect(relationshipBriefPanel).toContain("Safe personalization");
    expect(relationshipBriefPanel).toContain("Internal-only guidance");
    expect(relationshipBriefPanel).toContain("Use cautiously");
    expect(relationshipBriefPanel).toContain("Do not mention directly");
    expect(relationshipBriefPanel).toContain("Do not store protected traits");
    expect(relationshipBriefPanel).toContain("relationshipBriefLatestChangeForField");
    expect(relationshipBriefPanel).toContain("relationship-brief-change-list");
    expect(relationshipBriefPanel).toContain("relationship-brief-change-diff");
    expect(relationshipBriefPanel).toContain("relationship-brief-change-details");
    expect(relationshipBriefPanel).toContain("relationship-brief-history-toolbar");
    expect(relationshipBriefPanel).toContain("relationship-brief-history-source-filter");
    expect(relationshipBriefPanel).toContain("relationship-brief-history-field-filter");
    expect(relationshipBriefPanel).toContain("relationshipBriefFilteredChanges");
    expect(relationshipBriefPanel).toContain("relationshipBriefChangedFieldCounts");
    expect(globalStyles).toContain(".relationship-brief-review-field");
    expect(globalStyles).toContain(".relationship-brief-fact {\n  min-width: 0;");
    expect(globalStyles).toContain(".relationship-brief-usage-details summary");
    expect(globalStyles).toContain(".relationship-brief-change-card");
    expect(globalStyles).toContain(".relationship-brief-change-details summary");
    expect(globalStyles).toContain(".relationship-memory-card-grid");
    expect(globalStyles).toContain(".relationship-memory-review-summary");
    expect(globalStyles).toContain(".relationship-memory-card-empty");
    expect(globalStyles).toContain(".relationship-memory-value");
    expect(globalStyles).toContain("overflow-wrap: anywhere;");
    expect(relationshipBriefPanel).toContain("No Relationship Memory changes match these filters.");
    expect(relationshipBriefPanel).toContain("No Relationship Memory history has been recorded yet.");
    expect(relationshipBriefPanel).toContain("Meeting Intelligence");
    expect(relationshipBriefPanel).toContain("All fields");
    expect(relationshipBriefPanel).toContain("View source details");
    expect(relationshipBriefPanel).toContain("Accepted reviewed facts");
    expect(relationshipBriefPanel).toContain("Audit-backed read-only history");
    expect(relationshipBriefPanel).toContain("Manual contact-page edit");
    expect(relationshipBriefPanel).toContain("Review-first Meeting Intelligence provenance");
    expect(relationshipBriefPanel).toContain("sourceIntakeId");
    expect(relationshipBriefPanel).toContain("sourceOccurredAt");
    expect(relationshipBriefPanel).toContain("briefHistoryExcerpt");
    expect(relationshipBriefPanel).toContain("briefHistoryDetailText");
    expect(relationshipBriefPanel).toContain("PATCH");
    expect(relationshipBriefPanel).toContain("/api/v1/workspaces/${workspaceId}/people/${personId}");
    expect(relationshipBriefPanel).toContain("maxLength={2000}");
    expect(relationshipBriefPanel).toContain("router.refresh()");
    expect(service).toContain("manualRelationshipBriefAuditMetadata");
    expect(service).toContain('type: "manual"');
    expect(service).toContain("acceptedFactCount: 0");
  });

  it("documents relationship memory as curated profile context, not raw notes or automatic AI writes", () => {
    expect(routeMap).toContain("Contact create/update accepts optional relationship brief fields");
    expect(currentStatus).toContain("Relationship Brief");
    expect(currentStatus).toContain("separate from raw notes and timeline history");
    expect(currentStatus).toContain("Manual saves and approved Meeting Intelligence changes both write concise field-level");
    expect(currentStatus).toContain("Meeting Intelligence can propose review-first Relationship Brief updates");
    expect(currentStatus).toContain("Users must approve and may edit Meeting Intelligence suggestions before any profile field changes");
    expect(currentStatus).toContain("no AI/provider writes personal context automatically");
  });
});

function modelBlock(model: string) {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Missing model ${model}`);
  return match[0];
}
