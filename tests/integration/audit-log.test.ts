import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { writeAuditLog } from "@/lib/services/workspace-access";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;

beforeAll(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.prisma.auditLog.deleteMany({
    where: { workspaceId: fixture.workspaceA.id, action: "test.metadata_serialized" }
  });
});

afterAll(async () => {
  await fixture?.cleanup();
  fixture = undefined;
  await disconnectPrisma();
});

describe("workspace audit logging", () => {
  it("stores non-JSON-safe metadata without failing the audit write", async () => {
    const fx = currentFixture();
    const metadata: { amount: bigint; nested?: unknown } = { amount: 123n };
    metadata.nested = metadata;

    await writeAuditLog(fx.actorA, "test.metadata_serialized", "Deal", fx.recordsA.deal.id, metadata);

    await expect(
      fx.prisma.auditLog.findFirstOrThrow({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "test.metadata_serialized",
          entityId: fx.recordsA.deal.id
        }
      })
    ).resolves.toMatchObject({
      workspaceId: fx.workspaceA.id,
      metadata: {
        amount: "123",
        nested: "[Circular]"
      }
    });
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Fixture was not initialized.");
  return fixture;
}
