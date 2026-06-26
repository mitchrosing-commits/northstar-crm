import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";

export const accountDisplayNameMaxLength = 120;

export function normalizeAccountDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
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

  return prisma.user.update({
    where: { id: actorUserId },
    data: { name: normalizedName },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true
    }
  });
}
