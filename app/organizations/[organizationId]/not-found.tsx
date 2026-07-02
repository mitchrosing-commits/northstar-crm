import Link from "next/link";

import { RouteStatusState } from "@/components/route-status-state";

export default function OrganizationNotFound() {
  const backToOrganizationsLabel = "Back to organizations from missing organization";

  return (
    <RouteStatusState
      actions={
        <Link aria-label={backToOrganizationsLabel} className="button-secondary" href="/organizations" title={backToOrganizationsLabel}>
          Back to organizations
        </Link>
      }
      description="This organization may have been deleted or may not belong to the current workspace."
      title="Organization not found"
    />
  );
}
