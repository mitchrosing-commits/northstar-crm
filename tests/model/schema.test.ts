import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("Prisma CRM schema", () => {
  it("defines the core multi-tenant CRM models", () => {
    for (const model of [
      "User",
      "Session",
      "PasswordResetToken",
      "Workspace",
      "WorkspaceMembership",
      "Pipeline",
      "PipelineStage",
      "Deal",
      "Lead",
      "Person",
      "Organization",
      "Activity",
      "Note",
      "CustomFieldDefinition",
      "CustomFieldValue",
      "SavedView",
      "AuditLog"
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it("requires workspace ownership on major CRM records", () => {
    for (const model of ["Pipeline", "PipelineStage", "Deal", "Lead", "Person", "Organization", "Activity", "Note", "SavedView"]) {
      const block = modelBlock(model);
      expect(block).toMatch(/workspaceId\s+String/);
      expect(block).toContain("workspace");
    }
  });

  it("uses soft deletes on mutable business records", () => {
    for (const model of ["Workspace", "Pipeline", "PipelineStage", "Deal", "Lead", "Person", "Organization", "Activity", "Note"]) {
      expect(modelBlock(model)).toContain("deletedAt");
    }
  });
});

function modelBlock(model: string) {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Missing model ${model}`);
  return match[0];
}
