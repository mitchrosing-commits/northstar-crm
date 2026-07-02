import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scopeWorkspaceRelation } from "@/lib/services/relation-scope";

const recordGuards = readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8");

describe("workspace relation scoping helpers", () => {
  it("keeps only active relations from the current workspace", () => {
    const activeRelation = {
      id: "person_1",
      workspaceId: "workspace_a",
      deletedAt: null,
      name: "Active Customer"
    };

    expect(scopeWorkspaceRelation("workspace_a", activeRelation)).toBe(activeRelation);
    expect(scopeWorkspaceRelation("workspace_a", null)).toBeNull();
    expect(
      scopeWorkspaceRelation("workspace_a", {
        ...activeRelation,
        workspaceId: "workspace_b"
      })
    ).toBeNull();
    expect(
      scopeWorkspaceRelation("workspace_a", {
        ...activeRelation,
        deletedAt: new Date("2030-01-01T00:00:00.000Z")
      })
    ).toBeNull();
    expect(
      scopeWorkspaceRelation("workspace_a", {
        ...activeRelation,
        deletedAt: "2030-01-01T00:00:00.000Z"
      })
    ).toBeNull();
  });

  it("uses one shared attachment relation guard for activities, notes, and email logs", () => {
    expect(recordGuards).toContain("function attachmentRelationConstraints(workspaceId: string)");
    expect(recordGuards).toContain("const activeRecordWhere = { workspaceId, ...activeWhere }");
    expect(recordGuards).toContain("{ OR: [{ dealId: null }, { deal: { is: activeRecordWhere } }] }");
    expect(recordGuards).toContain("{ OR: [{ leadId: null }, { lead: { is: activeRecordWhere } }] }");
    expect(recordGuards).toContain("{ OR: [{ personId: null }, { person: { is: activeRecordWhere } }] }");
    expect(recordGuards).toContain("{ OR: [{ organizationId: null }, { organization: { is: activeRecordWhere } }] }");
    expect(recordGuards).toContain("export function activityAttachmentRelationsWhere(workspaceId: string)");
    expect(recordGuards).toContain("export function noteAttachmentRelationsWhere(workspaceId: string)");
    expect(recordGuards).toContain("export function emailLogAttachmentRelationsWhere(workspaceId: string)");
    expect(recordGuards).toContain("return attachmentRelationConstraints(workspaceId) as Prisma.ActivityWhereInput");
    expect(recordGuards).toContain("return attachmentRelationConstraints(workspaceId) as Prisma.NoteWhereInput");
    expect(recordGuards).toContain("return attachmentRelationConstraints(workspaceId) as Prisma.EmailLogWhereInput");
  });
});
