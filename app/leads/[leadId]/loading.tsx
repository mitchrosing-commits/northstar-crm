import { RouteStatusState } from "@/components/route-status-state";

export default function LeadLoading() {
  return <RouteStatusState description="Fetching lead details, conversion context, activities, and notes." title="Loading lead" />;
}
