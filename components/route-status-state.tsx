import { EmptyState } from "@/components/empty-state";

type RouteStatusStateProps = {
  actions?: React.ReactNode;
  description: React.ReactNode;
  title: string;
};

export function RouteStatusState({ actions, description, title }: RouteStatusStateProps) {
  return (
    <main className="main">
      <EmptyState actions={actions} description={description} title={title} titleLevel="h1" />
    </main>
  );
}
