import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type EnvInput = Record<string, string | undefined>;

let prepared = false;

export function prepareIntegrationDatabase({ deployMigrations = true }: { deployMigrations?: boolean } = {}) {
  loadDotEnv();
  const databaseUrlForComparison = getOriginalDatabaseUrl();
  const testDatabaseUrl = requireSafeTestDatabaseUrl(databaseUrlForComparison);
  process.env.DATABASE_URL = testDatabaseUrl;

  if (!deployMigrations) return;
  if (prepared) return;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit"
  });
  prepared = true;
}

export async function resetIntegrationDatabase() {
  assertIntegrationResetRuntimeEnv();
  const testDatabaseUrl = requireSafeTestDatabaseUrl();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: testDatabaseUrl
      }
    }
  });
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      DECLARE
        table_names text;
      BEGIN
        SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
          INTO table_names
          FROM pg_tables
         WHERE schemaname = current_schema()
           AND tablename <> '_prisma_migrations';

        IF table_names IS NOT NULL THEN
          EXECUTE 'TRUNCATE TABLE ' || table_names || ' RESTART IDENTITY CASCADE';
        END IF;
      END $$;
    `);
  } finally {
    await prisma.$disconnect();
  }
}

export function assertIntegrationResetRuntimeEnv(env: EnvInput = process.env) {
  if (env.NODE_ENV === "test" || env.VITEST === "true") return;
  throw new Error("Integration database reset can only run under Vitest or NODE_ENV=test.");
}

export function requireSafeTestDatabaseUrl(databaseUrlForComparison = getOriginalDatabaseUrl()) {
  loadDotEnv();
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for integration tests.");
  }

  assertSafeTestDatabaseUrl(testDatabaseUrl, databaseUrlForComparison);
  return testDatabaseUrl;
}

export function assertSafeTestDatabaseUrl(testDatabaseUrl: string, databaseUrl?: string) {
  let parsed: URL;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("TEST_DATABASE_URL must use the PostgreSQL protocol.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  const schemaName = (parsed.searchParams.get("schema") ?? "").toLowerCase();
  const hasTestMarker = databaseName.includes("test") || schemaName.includes("test");
  const unsafeMarker = unsafeDatabaseUrlMarker(parsed, databaseName, schemaName);

  if (!hasTestMarker) {
    throw new Error("TEST_DATABASE_URL must include 'test' in the database name or schema.");
  }

  if (unsafeMarker) {
    throw new Error(`TEST_DATABASE_URL must not contain production/staging/live markers: ${unsafeMarker}.`);
  }

  if (databaseUrl && normalizeDatabaseUrl(testDatabaseUrl) === normalizeDatabaseUrl(databaseUrl)) {
    throw new Error("TEST_DATABASE_URL must not point at the same database/schema as DATABASE_URL.");
  }
}

function normalizeDatabaseUrl(value: string) {
  const parsed = new URL(value);
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function unsafeDatabaseUrlMarker(parsed: URL, databaseName: string, schemaName: string) {
  return [parsed.hostname, databaseName, schemaName, parsed.username]
    .map((value) => value.toLowerCase())
    .find((value) => hasUnsafeEnvironmentToken(value));
}

function hasUnsafeEnvironmentToken(value: string) {
  const tokens = value.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((token) => token === "prod" || token === "production" || token === "staging" || token === "stage" || token === "live");
}

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(rawValue.trim());
  }
}

function getOriginalDatabaseUrl() {
  if (process.env.NORTHSTAR_INTEGRATION_DATABASE_URL) {
    return process.env.NORTHSTAR_INTEGRATION_DATABASE_URL;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    process.env.NORTHSTAR_INTEGRATION_DATABASE_URL = databaseUrl;
  }

  return databaseUrl;
}

function unquote(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
