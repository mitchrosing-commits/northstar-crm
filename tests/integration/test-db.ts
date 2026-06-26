import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let prepared = false;

export function prepareIntegrationDatabase() {
  loadDotEnv();
  const databaseUrlForComparison = getOriginalDatabaseUrl();
  const testDatabaseUrl = requireSafeTestDatabaseUrl(databaseUrlForComparison);
  process.env.DATABASE_URL = testDatabaseUrl;

  if (prepared) return;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit"
  });
  prepared = true;
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

function assertSafeTestDatabaseUrl(testDatabaseUrl: string, databaseUrl?: string) {
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

  if (!hasTestMarker) {
    throw new Error("TEST_DATABASE_URL must include 'test' in the database name or schema.");
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
