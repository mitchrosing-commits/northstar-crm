import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { AssistantConsole } from "@/components/assistant-console";
import { PageHeader } from "@/components/page-header";
import { RecordPanelJumpNav } from "@/components/record-panel-jump-nav";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listAssistantActionRequests } from "@/lib/services/assistant/assistant-action-request-service";
import { answerAssistantCommand } from "@/lib/services/assistant/assistant-command-service";
import { getAssistantConversation, listAssistantConversations } from "@/lib/services/assistant/assistant-conversation-service";
import { buildAssistantTodayCommandCenter } from "@/lib/services/assistant/assistant-today-command-center-service";
import { getAiPreferences, listCrmChangeProposals } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    actionRequest?: string;
    assistantChat?: string;
    command?: string;
    conversation?: string;
    queue?: string;
    today?: string;
    todayCommandCenter?: string;
  }>;
};

export default async function AssistantPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const command = normalizeCommandParam(resolvedSearchParams.command);
  const conversationId = normalizeConversationId(resolvedSearchParams.conversation);
  const assistantChatStatus = normalizeAssistantChatStatus(resolvedSearchParams.assistantChat);
  const actionRequestStatus = normalizeActionRequestStatus(resolvedSearchParams.actionRequest);
  const actionRequestQueue = normalizeActionRequestQueue(resolvedSearchParams.queue);
  const todayCommandCenterStatus = normalizeTodayCommandCenterStatus(resolvedSearchParams.todayCommandCenter);
  const showHiddenTodayItems = resolvedSearchParams.today === "hidden";
  const { actor, workspace } = await getCurrentWorkspaceContext();
  const [answer, conversation, conversations, pendingActionRequests, crmChangeProposalReview, todayCommandCenter, preferences] = await Promise.all([
    command ? answerAssistantCommand(actor, command) : Promise.resolve(null),
    getAssistantConversation(actor, conversationId),
    listAssistantConversations(actor),
    listAssistantActionRequests(actor),
    listCrmChangeProposals(actor),
    buildAssistantTodayCommandCenter(actor, new Date(), { showHidden: showHiddenTodayItems }),
    getAiPreferences(actor)
  ]);
  const assistantDisplayName = preferences.assistantNamePreset === "Custom" && preferences.assistantCustomName
    ? preferences.assistantCustomName
    : preferences.assistantNamePreset;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Northstar Assistant"
        subtitle="Ask deterministic CRM questions, draft review-first actions, and manage pending Assistant action requests."
        title="Assistant"
      >
        <RecordPanelJumpNav
          ariaLabel="Assistant page sections"
          jumps={[
            { href: "#assistant-chat-composer" as Route, label: `Chat with ${assistantDisplayName}` },
            { href: "#assistant-chat-thread" as Route, label: "Conversation" },
            {
              href: "#assistant-today-command-center-title" as Route,
              label: "Today",
              count: todayCommandCenter.items.length,
              countLabel: { singular: "item", plural: "items" }
            },
            {
              href: "#assistant-review-queue" as Route,
              label: "Review queue",
              count: pendingActionRequests.filter((request) => request.status === "PENDING").length,
              countLabel: { singular: "pending request", plural: "pending requests" }
            }
          ]}
          label="Sections"
        />
      </PageHeader>
      <AssistantConsole
        actionRequestQueue={actionRequestQueue}
        actionRequestStatus={actionRequestStatus}
        answer={answer}
        assistantChatStatus={assistantChatStatus}
        assistantName={assistantDisplayName}
        assistantTone={preferences.assistantTonePreset}
        command={command}
        conversation={conversation}
        conversations={conversations}
        crmChangeProposals={crmChangeProposalReview.proposals.filter((proposal) => proposal.sourceType === "assistant")}
        pendingActionRequests={pendingActionRequests}
        todayCommandCenter={todayCommandCenter}
        todayCommandCenterStatus={todayCommandCenterStatus}
      />
    </AppShell>
  );
}

function normalizeCommandParam(value: string | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 640) : "";
}

function normalizeConversationId(value: string | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function normalizeAssistantChatStatus(value: string | undefined) {
  if (value === "sent" || value === "error") return value;
  return "";
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

function normalizeTodayCommandCenterStatus(value: string | undefined) {
  if (value === "hidden" || value === "hide-error") return value;
  return "";
}
