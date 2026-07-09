import { AppShell } from "@/components/app-shell";
import { AssistantConsole } from "@/components/assistant-console";
import { PageHeader } from "@/components/page-header";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listAssistantActionRequests } from "@/lib/services/assistant/assistant-action-request-service";
import { answerAssistantCommand } from "@/lib/services/assistant/assistant-command-service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ actionRequest?: string; command?: string; queue?: string }>;
};

export default async function AssistantPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const command = normalizeCommandParam(resolvedSearchParams.command);
  const actionRequestStatus = normalizeActionRequestStatus(resolvedSearchParams.actionRequest);
  const actionRequestQueue = normalizeActionRequestQueue(resolvedSearchParams.queue);
  const { actor, workspace } = await getCurrentWorkspaceContext();
  const [answer, pendingActionRequests] = await Promise.all([
    command ? answerAssistantCommand(actor, command) : Promise.resolve(null),
    listAssistantActionRequests(actor)
  ]);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Northstar Assistant"
        subtitle="Ask deterministic CRM questions, draft review-first actions, and manage pending Assistant action requests."
        title="Assistant"
      />
      <AssistantConsole
        actionRequestQueue={actionRequestQueue}
        actionRequestStatus={actionRequestStatus}
        answer={answer}
        command={command}
        pendingActionRequests={pendingActionRequests}
      />
    </AppShell>
  );
}

function normalizeCommandParam(value: string | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 640) : "";
}

function normalizeActionRequestStatus(value: string | undefined) {
  if (value === "saved" || value === "applied" || value === "rejected" || value === "error" || value === "apply-error" || value === "reject-error") {
    return value;
  }
  return "";
}

function normalizeActionRequestQueue(value: string | undefined) {
  if (value === "all" || value === "applied" || value === "pending" || value === "rejected") {
    return value;
  }
  return "pending";
}
