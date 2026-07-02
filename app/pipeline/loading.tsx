import { RouteStatusState } from "@/components/route-status-state";

export default function PipelineLoading() {
  return <RouteStatusState description="Preparing stages and deals." title="Loading pipeline" />;
}
