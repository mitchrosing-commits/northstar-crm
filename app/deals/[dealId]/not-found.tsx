import Link from "next/link";

import { RouteStatusState } from "@/components/route-status-state";

export default function DealNotFound() {
  const backToPipelineLabel = "Back to pipeline from missing deal";

  return (
    <RouteStatusState
      actions={
        <Link aria-label={backToPipelineLabel} className="button-secondary" href="/pipeline" title={backToPipelineLabel}>
          Back to pipeline
        </Link>
      }
      description="This deal may have been deleted or may not belong to the current workspace."
      title="Deal not found"
    />
  );
}
