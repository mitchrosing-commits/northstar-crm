import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { userDisplaySelect } from "@/lib/services/user-select";

const servicesDir = join(process.cwd(), "lib/services");
const serviceSources = readdirSync(servicesDir)
  .filter((fileName) => fileName.endsWith(".ts"))
  .map((fileName) => ({
    fileName,
    source: readFileSync(join(servicesDir, fileName), "utf8")
  }));

const userDisplayRelationNames = [
  "actor",
  "assignedTo",
  "author",
  "completedBy",
  "createdBy",
  "invitedBy",
  "owner",
  "user"
];

describe("display user selection", () => {
  it("selects only safe display fields", () => {
    expect(userDisplaySelect).toEqual({
      id: true,
      name: true,
      email: true
    });
    expect(Object.keys(userDisplaySelect).sort()).toEqual(["email", "id", "name"]);
  });

  it("keeps display User relations in services on the shared selector", () => {
    const broadIncludePattern = new RegExp(`\\b(${userDisplayRelationNames.join("|")})\\s*:\\s*true\\b`);
    const inlineUserSelectPattern = new RegExp(
      `\\b(${userDisplayRelationNames.join("|")})\\s*:\\s*\\{\\s*select\\s*:\\s*\\{`
    );
    const passwordHashPattern = /\bpasswordHash\b/;
    const failures: string[] = [];

    for (const { fileName, source } of serviceSources) {
      if (broadIncludePattern.test(source)) {
        failures.push(`${fileName} has a broad display User relation include`);
      }
      if (inlineUserSelectPattern.test(source)) {
        failures.push(`${fileName} has an inline display User relation select instead of userDisplaySelect`);
      }
      if (passwordHashPattern.test(source)) {
        failures.push(`${fileName} reads passwordHash from a display/service query`);
      }
    }

    expect(failures).toEqual([]);
  });
});
