export type RecordOwnerLabelUser = {
  name?: string | null;
  email?: string | null;
} | null;

export function recordOwnerLabel(owner?: RecordOwnerLabelUser) {
  return owner ? `Owner: ${owner.name ?? owner.email}` : "Owner: Unassigned";
}
