import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";

export const accountDisplayNameMaxLength = 120;

export function normalizeAccountDisplayName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export async function updateCurrentUserDisplayName(actorUserId: string, value: string) {
  const normalizedName = normalizeAccountDisplayName(value);

  if (!normalizedName) {
    throw new ApiError("VALIDATION_ERROR", "Display name is required.", 422);
  }

  if (normalizedName.length > accountDisplayNameMaxLength) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Display name must be ${accountDisplayNameMaxLength} characters or fewer.`,
      422
    );
  }

  return prisma.$transaction(async (tx) => {
    const update = await tx.user.updateMany({
      where: { id: actorUserId, deletedAt: null },
      data: { name: normalizedName }
    });

    if (update.count === 0) {
      throw new ApiError("UNAUTHENTICATED", "The current user could not be resolved.", 401);
    }

    const user = await tx.user.findFirst({
      where: { id: actorUserId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true
      }
    });

    if (!user) {
      throw new ApiError("UNAUTHENTICATED", "The current user could not be resolved.", 401);
    }

    return user;
  });
}
