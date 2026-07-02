import Link from "next/link";

import { RouteStatusState } from "@/components/route-status-state";

export default function ContactNotFound() {
  const backToContactsLabel = "Back to contacts from missing contact";

  return (
    <RouteStatusState
      actions={
        <Link aria-label={backToContactsLabel} className="button-secondary" href="/contacts" title={backToContactsLabel}>
          Back to contacts
        </Link>
      }
      description="This contact may have been deleted or may not belong to the current workspace."
      title="Contact not found"
    />
  );
}
