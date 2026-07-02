import { RouteStatusState } from "@/components/route-status-state";

export default function ContactLoading() {
  return <RouteStatusState description="Fetching contact details, activities, and relationship history." title="Loading contact" />;
}
