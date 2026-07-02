import { RouteStatusState } from "@/components/route-status-state";

export default function OrganizationLoading() {
  return <RouteStatusState description="Fetching organization details, people, deals, and activity history." title="Loading organization" />;
}
