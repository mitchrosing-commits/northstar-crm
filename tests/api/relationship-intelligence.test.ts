import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { personRelationshipProfile } from "@/lib/services/contact-service";

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

  it("renders and edits the Relationship Brief from the contact detail page", () => {
    expect(contactPage).toContain("RelationshipBriefPanel");
    expect(contactPage).toContain("type RelationshipBriefHistoryItem");
    expect(contactPage).toContain("const relationshipBrief = {");
    expect(contactPage).toContain("recentRelationshipBriefChanges(person.auditLogs)");
    expect(contactPage).toContain("relationshipBriefChangesFromMetadata");
    expect(contactPage).toContain("relationshipBriefHistorySourceLabel");
    expect(contactPage).toContain("href: \"#relationship-brief\" as Route");
    expect(contactPage).toContain("<RelationshipBriefPanel");
    expect(contactPage).toContain("recentChanges={relationshipBriefChanges}");
    expect(relationshipBriefPanel).toContain('title="Relationship Brief"');
    expect(relationshipBriefPanel).toContain('title="Recent Relationship Brief Changes"');
    expect(relationshipBriefPanel).toContain("Curated relationship context for thoughtful follow-up.");
    expect(relationshipBriefPanel).toContain("relationship-brief-change-list");
    expect(relationshipBriefPanel).toContain("relationship-brief-change-diff");
    expect(relationshipBriefPanel).toContain("briefHistoryExcerpt");
    expect(relationshipBriefPanel).toContain("Personal context");
    expect(relationshipBriefPanel).toContain("Communication style");
    expect(relationshipBriefPanel).toContain("Business concerns");
    expect(relationshipBriefPanel).toContain("Follow-up reminders");
    expect(relationshipBriefPanel).toContain("Internal guidance");
    expect(relationshipBriefPanel).toContain("PATCH");
    expect(relationshipBriefPanel).toContain("/api/v1/workspaces/${workspaceId}/people/${personId}");
    expect(relationshipBriefPanel).toContain("maxLength={2000}");
    expect(relationshipBriefPanel).toContain("router.refresh()");
  });

  it("documents relationship memory as curated profile context, not raw notes or automatic AI writes", () => {
    expect(routeMap).toContain("Contact create/update accepts optional relationship brief fields");
    expect(currentStatus).toContain("Relationship Brief");
    expect(currentStatus).toContain("separate from raw notes and timeline history");
    expect(currentStatus).toContain("Meeting Intelligence can propose review-first Relationship Brief updates");
    expect(currentStatus).toContain("Users must approve and may edit those suggestions before any profile field changes");
    expect(currentStatus).toContain("no AI/provider writes personal context automatically");
  });
});

function modelBlock(model: string) {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Missing model ${model}`);
  return match[0];
}
