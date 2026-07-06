import { prepareIntegrationDatabase, resetIntegrationDatabase } from "./test-db";

export default async function globalSetup() {
  prepareIntegrationDatabase();
  // Run after migrations so app tables are empty while _prisma_migrations remains intact.
  await resetIntegrationDatabase();
}
