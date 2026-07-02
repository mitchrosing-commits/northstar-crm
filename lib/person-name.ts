export type PersonNameParts = {
  firstName?: string | null;
  lastName?: string | null;
} | null;

export function formatPersonName(person?: PersonNameParts) {
  if (!person) return null;

  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || null;
}
