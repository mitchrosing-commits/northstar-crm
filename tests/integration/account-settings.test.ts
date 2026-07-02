import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accountDisplayNameMaxLength,
  normalizeAccountDisplayName,
  updateCurrentUserDisplayName
} from "@/lib/auth/account";
import { hashPassword } from "@/lib/auth/password";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("account settings display name update", () => {
  it("updates the signed-in user's display name and preserves email and password hash", async () => {
    const fx = currentFixture();
    const originalPasswordHash = hashPassword("existing-password");
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { passwordHash: originalPasswordHash }
    });

    const updated = await updateCurrentUserDisplayName(fx.userA.id, "  Northstar   Operator  ");
    const stored = await fx.prisma.user.findUniqueOrThrow({
      where: { id: fx.userA.id },
      select: { id: true, email: true, name: true, passwordHash: true }
    });
    const otherUser = await fx.prisma.user.findUniqueOrThrow({
      where: { id: fx.userB.id },
      select: { name: true }
    });

    expect(updated).toMatchObject({
      id: fx.userA.id,
      email: fx.userA.email,
      name: "Northstar Operator"
    });
    expect(stored).toEqual({
      id: fx.userA.id,
      email: fx.userA.email,
      name: "Northstar Operator",
      passwordHash: originalPasswordHash
    });
    expect(otherUser.name).toBe(fx.userB.name);
  });

  it("does not expose a target-user parameter for workspace admins to edit another profile", async () => {
    const fx = currentFixture();
    await fx.prisma.workspaceMembership.create({
      data: {
        workspaceId: fx.workspaceA.id,
        userId: fx.userB.id,
        role: "ADMIN"
      }
    });

    await updateCurrentUserDisplayName(fx.userB.id, "Workspace Admin");

    const owner = await fx.prisma.user.findUniqueOrThrow({
      where: { id: fx.userA.id },
      select: { name: true }
    });
    const admin = await fx.prisma.user.findUniqueOrThrow({
      where: { id: fx.userB.id },
      select: { name: true }
    });

    expect(owner.name).toBe(fx.userA.name);
    expect(admin.name).toBe("Workspace Admin");
  });

  it("rejects stale or deleted current users without mutating their profile", async () => {
    const fx = currentFixture();
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { deletedAt: new Date("2030-04-01T00:00:00.000Z") }
    });

    await expect(updateCurrentUserDisplayName(fx.userA.id, "Deleted User Rename")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "The current user could not be resolved.",
      status: 401
    });
    await expect(
      fx.prisma.user.findUniqueOrThrow({
        where: { id: fx.userA.id },
        select: { name: true }
      })
    ).resolves.toEqual({ name: fx.userA.name });
  });

  it("rejects empty and overlong display names", async () => {
    const fx = currentFixture();
    const originalUser = await fx.prisma.user.findUniqueOrThrow({
      where: { id: fx.userA.id },
      select: { name: true }
    });

    await expect(updateCurrentUserDisplayName(fx.userA.id, "   ")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Display name is required.",
      status: 422
    });
    await expect(updateCurrentUserDisplayName(fx.userA.id, { name: "Object Name" } as unknown as string)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Display name is required.",
      status: 422
    });
    await expect(updateCurrentUserDisplayName(fx.userA.id, "x".repeat(accountDisplayNameMaxLength + 1))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(fx.prisma.user.findUniqueOrThrow({ where: { id: fx.userA.id }, select: { name: true } })).resolves.toEqual(
      originalUser
    );
  });

  it("normalizes surrounding and repeated whitespace", () => {
    expect(normalizeAccountDisplayName("  Alex   Revenue  ")).toBe("Alex Revenue");
    expect(normalizeAccountDisplayName({ name: "Alex Revenue" })).toBe("");
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
