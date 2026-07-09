import { AppShell } from "@/components/app-shell";
import { AssistantConsole } from "@/components/assistant-console";
import { PageHeader } from "@/components/page-header";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { answerAssistantCommand } from "@/lib/services/assistant/assistant-command-service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ command?: string }>;
};

export default async function AssistantPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const command = normalizeCommandParam(resolvedSearchParams.command);
  const { actor, workspace } = await getCurrentWorkspaceContext();
  const answer = command ? await answerAssistantCommand(actor, command) : null;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Northstar Assistant"
        subtitle="Ask deterministic, read-only CRM questions across activities, deals, and stored email context."
        title="Assistant"
      />
      <AssistantConsole answer={answer} command={command} />
    </AppShell>
  );
}

function normalizeCommandParam(value: string | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 240) : "";
}
