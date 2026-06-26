import { ActivityType, DealStatus, LeadStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type AutomationTemplateId =
  | "lead-first-outreach"
  | "deal-proposal-follow-up"
  | "quote-follow-up"
  | "contract-follow-up"
  | "post-sale-handoff"
  | "deal-next-activity"
  | "lost-reengagement";

export type AutomationTemplateResult = {
  activityId: string;
  created: boolean;
};

type ActivitySuggestion = {
  dealId?: string;
  leadId?: string;
  type: ActivityType;
  title: string;
  description: string;
  dueAt: Date;
};

export async function createAutomationTemplateActivity(
  actor: WorkspaceActor,
  input: { templateId: AutomationTemplateId; dealId?: string; leadId?: string },
  now = new Date()
): Promise<AutomationTemplateResult> {
  await ensureWorkspaceAccess(actor);
  const suggestion = await resolveAutomationTemplate(actor, input, now);

  const existing = await prisma.activity.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      completedAt: null,
      deletedAt: null,
      title: suggestion.title,
      dealId: suggestion.dealId ?? null,
      leadId: suggestion.leadId ?? null
    },
    select: { id: true }
  });

  if (existing) return { activityId: existing.id, created: false };

  const activity = await prisma.activity.create({
    data: {
      workspaceId: actor.workspaceId,
      ownerId: actor.actorUserId,
      dealId: suggestion.dealId,
      leadId: suggestion.leadId,
      type: suggestion.type,
      title: suggestion.title,
      description: suggestion.description,
      dueAt: suggestion.dueAt
    }
  });

  await writeAuditLog(actor, "automation_template.activity_created", "Activity", activity.id, {
    templateId: input.templateId,
    dealId: suggestion.dealId,
    leadId: suggestion.leadId
  });

  return { activityId: activity.id, created: true };
}

async function resolveAutomationTemplate(
  actor: WorkspaceActor,
  input: { templateId: AutomationTemplateId; dealId?: string; leadId?: string },
  now: Date
): Promise<ActivitySuggestion> {
  if (input.templateId === "lead-first-outreach") {
    if (!input.leadId) throw new ApiError("VALIDATION_ERROR", "Lead automation requires a lead.", 422);
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, title: true, status: true }
    });
    if (!lead) throw new ApiError("NOT_FOUND", "Lead was not found.", 404);
    if (lead.status === LeadStatus.CONVERTED) {
      throw new ApiError("VALIDATION_ERROR", "Create follow-up on the converted deal instead.", 422);
    }
    return {
      leadId: lead.id,
      type: ActivityType.CALL,
      title: `First outreach: ${lead.title}`,
      description: "Automation template: contact this lead and qualify next steps.",
      dueAt: addDays(now, 1)
    };
  }

  if (!input.dealId) throw new ApiError("VALIDATION_ERROR", "Deal automation requires a deal.", 422);
  const deal = await prisma.deal.findFirst({
    where: { id: input.dealId, workspaceId: actor.workspaceId, ...activeWhere },
    include: { stage: true }
  });
  if (!deal) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);

  if (input.templateId === "deal-proposal-follow-up") {
    return dealSuggestion(deal.id, ActivityType.EMAIL, `Proposal follow-up: ${deal.title}`, "Automation template: follow up after proposal review.", addDays(now, 3));
  }
  if (input.templateId === "quote-follow-up") {
    return dealSuggestion(deal.id, ActivityType.EMAIL, `Quote follow-up: ${deal.title}`, "Automation template: check whether the customer has questions on the quote.", addDays(now, 3));
  }
  if (input.templateId === "contract-follow-up") {
    return dealSuggestion(deal.id, ActivityType.TASK, `Contract follow-up: ${deal.title}`, "Automation template: unblock NDA/MSA/SOW progress.", addDays(now, 1));
  }
  if (input.templateId === "post-sale-handoff") {
    if (deal.status !== DealStatus.WON) {
      throw new ApiError("VALIDATION_ERROR", "Post-sale handoff is available after a deal is won.", 422);
    }
    return dealSuggestion(deal.id, ActivityType.TASK, `Post-sale handoff: ${deal.title}`, "Automation template: coordinate onboarding, implementation, and customer success handoff.", addDays(now, 1));
  }
  if (input.templateId === "lost-reengagement") {
    if (deal.status !== DealStatus.LOST) {
      throw new ApiError("VALIDATION_ERROR", "Re-engagement follow-up is available after a deal is lost.", 422);
    }
    return dealSuggestion(deal.id, ActivityType.TASK, `Re-engage later: ${deal.title}`, "Automation template: revisit this lost opportunity after timing or fit changes.", addDays(now, 30));
  }

  return dealSuggestion(deal.id, ActivityType.TASK, `Schedule next step: ${deal.title}`, "Automation template: every open deal should have a next activity.", addDays(now, 1));
}

function dealSuggestion(dealId: string, type: ActivityType, title: string, description: string, dueAt: Date): ActivitySuggestion {
  return {
    dealId,
    type,
    title,
    description,
    dueAt
  };
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}
