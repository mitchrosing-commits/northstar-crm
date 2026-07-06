import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertIntegrationResetRuntimeEnv,
  assertSafeTestDatabaseUrl
} from "@/tests/integration/test-db";

describe("integration test database safety", () => {
  it("allows destructive integration reset only in a test runtime", () => {
    expect(() => assertIntegrationResetRuntimeEnv({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertIntegrationResetRuntimeEnv({ VITEST: "true" })).not.toThrow();
    expect(() => assertIntegrationResetRuntimeEnv({ NODE_ENV: "development" })).toThrow(
      "Integration database reset can only run under Vitest or NODE_ENV=test."
    );
  });

  it("requires a clearly marked PostgreSQL test database that is not the app database", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://crm:crm@localhost:5432/crm_mvp_test?schema=public",
        "postgresql://crm:crm@localhost:5432/crm_mvp?schema=public"
      )
    ).not.toThrow();
    expect(() => assertSafeTestDatabaseUrl("mysql://crm:crm@localhost:3306/crm_mvp_test")).toThrow(
      "TEST_DATABASE_URL must use the PostgreSQL protocol."
    );
    expect(() => assertSafeTestDatabaseUrl("postgresql://crm:crm@localhost:5432/crm_mvp")).toThrow(
      "TEST_DATABASE_URL must include 'test' in the database name or schema."
    );
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://crm:crm@localhost:5432/crm_mvp_test?schema=public",
        "postgresql://other:secret@localhost:5432/crm_mvp_test?schema=public"
      )
    ).toThrow("TEST_DATABASE_URL must not point at the same database/schema as DATABASE_URL.");
  });

  it("refuses obvious production, staging, or live database URL markers even when test appears elsewhere", () => {
    for (const value of [
      "postgresql://crm:crm@prod-db.localhost:5432/crm_mvp_test",
      "postgresql://crm:crm@localhost:5432/production_test",
      "postgresql://crm:crm@localhost:5432/crm_mvp_test?schema=staging",
      "postgresql://live:crm@localhost:5432/crm_mvp_test"
    ]) {
      expect(() => assertSafeTestDatabaseUrl(value)).toThrow(
        /TEST_DATABASE_URL must not contain production\/staging\/live markers:/
      );
    }
  });

  it("keeps migration deploy and destructive reset in global setup only", () => {
    expect(readFileSync("tests/integration/setup.ts", "utf8")).toContain(
      "prepareIntegrationDatabase({ deployMigrations: false })"
    );
    expect(readFileSync("tests/integration/global-setup.ts", "utf8")).toContain("prepareIntegrationDatabase()");
    expect(readFileSync("tests/integration/global-setup.ts", "utf8")).toContain("resetIntegrationDatabase()");
  });
});
