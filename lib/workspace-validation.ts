import { ApiError } from "@/lib/api/responses";

export const workspaceNameMaxLength = 120;
export const workspaceSlugMaxLength = 80;
export const workspaceSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeWorkspaceName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function validateWorkspaceName(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Workspace name is required.", 422);
  }

  const normalizedName = normalizeWorkspaceName(value);

  if (!normalizedName) {
    throw new ApiError("VALIDATION_ERROR", "Workspace name is required.", 422);
  }

  if (normalizedName.length > workspaceNameMaxLength) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Workspace name must be ${workspaceNameMaxLength} characters or fewer.`,
      422
    );
  }

  return normalizedName;
}

export function validateWorkspaceSlug(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Workspace slug is required.", 422);
  }

  const slug = value.trim();

  if (!slug) {
    throw new ApiError("VALIDATION_ERROR", "Workspace slug is required.", 422);
  }

  if (slug.length > workspaceSlugMaxLength) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Workspace slug must be ${workspaceSlugMaxLength} characters or fewer.`,
      422
    );
  }

  if (!workspaceSlugPattern.test(slug)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Workspace slug may contain lowercase letters, numbers, and single hyphens only.",
      422
    );
  }

  return slug;
}
