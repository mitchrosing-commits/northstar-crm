export type WorkspaceScopedRelation = { workspaceId: string; deletedAt?: Date | string | null } | null;

export function scopeWorkspaceRelation<T extends { workspaceId: string; deletedAt?: Date | string | null }>(
  workspaceId: string,
  relation: T | null
): T | null {
  if (!relation || relation.workspaceId !== workspaceId || relation.deletedAt) return null;
  return relation;
}
