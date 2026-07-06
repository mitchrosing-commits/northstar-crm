import { afterAll, describe, expect, it } from "vitest";

import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

afterAll(async () => {
  await disconnectPrisma();
});

describe("integration fixture isolation", () => {
  it("creates complete owner workspaces when fixtures are created concurrently", async () => {
    const fixtures: Fixture[] = [];

    try {
      fixtures.push(...(await Promise.all(Array.from({ length: 4 }, () => createIntegrationFixture()))));

      const workspaceIds = fixtures.flatMap((fixture) => [fixture.workspaceA.id, fixture.workspaceB.id]);
      const userIds = fixtures.flatMap((fixture) => [fixture.userA.id, fixture.userB.id]);

      expect(new Set(workspaceIds)).toHaveLength(workspaceIds.length);
      expect(new Set(userIds)).toHaveLength(userIds.length);
      await expect(
        fixtures[0].prisma.workspaceMembership.count({
          where: { workspaceId: { in: workspaceIds }, role: "OWNER" }
        })
      ).resolves.toBe(workspaceIds.length);
      await expect(
        fixtures[0].prisma.user.count({
          where: { id: { in: userIds } }
        })
      ).resolves.toBe(userIds.length);
    } finally {
      await Promise.allSettled(fixtures.map((fixture) => fixture.cleanup()));
    }
  });

  it("keeps fixture cleanup scoped while another fixture is being created", async () => {
    let cleanupFixture: Fixture | undefined = await createIntegrationFixture();
    let createdFixture: Fixture | undefined;

    try {
      const [, created] = await Promise.all([cleanupFixture.cleanup(), createIntegrationFixture()]);
      cleanupFixture = undefined;
      createdFixture = created;

      await expect(
        createdFixture.prisma.workspaceMembership.count({
          where: { workspaceId: { in: [createdFixture.workspaceA.id, createdFixture.workspaceB.id] }, role: "OWNER" }
        })
      ).resolves.toBe(2);
      await expect(
        createdFixture.prisma.user.count({
          where: { id: { in: [createdFixture.userA.id, createdFixture.userB.id] } }
        })
      ).resolves.toBe(2);
    } finally {
      await cleanupFixture?.cleanup();
      await createdFixture?.cleanup();
    }
  });
});
