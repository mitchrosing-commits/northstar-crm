import Link from "next/link";

import { RouteStatusState } from "@/components/route-status-state";

export default function LeadNotFound() {
  const backToLeadsLabel = "Back to leads from missing lead";

  return (
    <RouteStatusState
      actions={
        <Link aria-label={backToLeadsLabel} className="button-secondary" href="/leads" title={backToLeadsLabel}>
          Back to leads
        </Link>
      }
      description="This lead may have been deleted or may not belong to the current workspace."
      title="Lead not found"
    />
  );
}
