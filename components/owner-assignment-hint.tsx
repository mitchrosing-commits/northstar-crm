import Link from "next/link";
import type { Route } from "next";

type OwnerOption = {
  id: string;
  name: string;
};

export function OwnerAssignmentHint({ owners }: { owners: OwnerOption[] }) {
  if (owners.length === 1) {
    const settingsLinkLabel = "Open settings to invite workspace teammates";

    return (
      <small className="form-hint">
        You are the only workspace member right now. Invite teammates later from{" "}
        <Link aria-label={settingsLinkLabel} className="inline-link" href={"/settings" as Route} title={settingsLinkLabel}>
          Settings
        </Link>
        .
      </small>
    );
  }
  if (owners.length === 0) {
    const settingsLinkLabel = "Open settings to manage workspace members";

    return (
      <small className="form-hint">
        Save unassigned for now, then manage workspace members from{" "}
        <Link aria-label={settingsLinkLabel} className="inline-link" href={"/settings" as Route} title={settingsLinkLabel}>
          Settings
        </Link>
        .
      </small>
    );
  }
  return null;
}
