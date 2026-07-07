import type { EmailConnectionProvider, EmailConnectionStatus, JobStatus, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { startOfDay } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { relationshipBriefUsageForField, type RelationshipBriefFieldKey } from "@/lib/relationship-brief-usage";
import { redactSensitiveText } from "@/lib/security/redaction";

import { readEmailSmartClassification } from "./email-classification-service";
import { defaultStaleJobAfterMs } from "./job-service";
import { userDisplaySelect } from "./user-select";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

type EnvInput = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export type NorthstarAssistantSurface =
  | "contact"
  | "deal"
  | "inbox"
  | "job_system"
  | "lead"
  | "meeting_intelligence"
  | "organization";

export type NorthstarAssistantConfidence = "high" | "low" | "medium";
export type NorthstarAssistantSeverity = "attention" | "info" | "success" | "warning";

export type NorthstarAssistantReadiness = {
  configured: boolean;
  message: string;
  missingEnvNames: string[];
  providerId: "none" | "openai";
  providerName: string;
};

export type NorthstarAssistantRecordSummary = {
  id: string;
  label: string;
  status?: string;
  type: "contact" | "deal" | "lead" | "organization";
};

export type NorthstarAssistantActivityContext = {
  completedAt: string | null;
  dueAt: string | null;
  id: string;
  linkedRecordLabel?: string;
  title: string;
  type: string;
};

export type NorthstarAssistantEmailContext = {
  classificationSummary?: string;
  direction: string;
  followUpCount?: number;
  id: string;
  linkedRecordLabel?: string;
  occurredAt: string;
  provider?: string | null;
  signals: string[];
  subject: string;
};

export type NorthstarAssistantConnectionContext = {
  accountEmail: string | null;
  createdAt: string;
  id: string;
  lastError: string | null;
  lastSyncAt: string | null;
  provider: string;
  scopeCategories: string[];
  status: string;
  updatedAt: string;
};

export type NorthstarAssistantJobContext = {
  attempts: number;
  createdAt: string;
  failedAt: string | null;
  id: string;
  lastError: string | null;
  lockedAt: string | null;
  maxAttempts: number;
  processedAt: string | null;
  runAt: string;
  status: string;
  type: string;
  updatedAt: string;
};

export type NorthstarAssistantAuditContext = {
  action: string;
  actorLabel?: string;
  createdAt: string;
  entityType: string;
  id: string;
  metadataSummary?: string;
};

export type NorthstarAssistantContext = {
  audits: NorthstarAssistantAuditContext[];
  generatedAt: string;
  lookedAt: string[];
  record?: NorthstarAssistantRecordSummary;
  related: {
    activities: NorthstarAssistantActivityContext[];
    connections: NorthstarAssistantConnectionContext[];
    emails: NorthstarAssistantEmailContext[];
    jobs: NorthstarAssistantJobContext[];
    notes: Array<{ body: string; createdAt: string; id: string }>;
    possibleLinks: Array<{ id: string; label: string; reason: string; type: "contact" | "deal" | "lead" | "organization" }>;
    proposalSummaries: string[];
    relationshipFacts: Array<{ field: RelationshipBriefFieldKey; label: string; value: string }>;
  };
  safety: {
    excludes: string[];
    reviewFirst: true;
    workspaceScoped: true;
  };
  surface: NorthstarAssistantSurface;
  system?: {
    env: Array<{ configured: boolean; key: "email_oauth" | "email_token_encryption" | "openai" | "worker"; label: string }>;
    jobStatusCounts: Record<string, number>;
  };
  workspaceId: string;
};

export type NorthstarAssistantFinding = {
  detail: string;
  evidence: string[];
  id: string;
  severity: NorthstarAssistantSeverity;
  title: string;
};

export type NorthstarAssistantSuggestedAction = {
  href?: string;
  id: string;
  kind:
    | "create_activity_proposal"
    | "create_note_proposal"
    | "link_record_proposal"
    | "mark_activity_complete_proposal"
    | "move_fact_proposal"
    | "reconnect_guidance"
    | "retry_sync_proposal"
    | "review_record";
  label: string;
  reason: string;
  reviewFirst: true;
};

export type NorthstarAssistantInsight = {
  cautions: string[];
  confidence: NorthstarAssistantConfidence;
  findings: NorthstarAssistantFinding[];
  generatedAt: string;
  guardrails: string[];
  lookedAt: string[];
  mode: "deterministic" | "provider";
  providerId: "deterministic" | "openai";
  providerName: string;
  suggestedActions: NorthstarAssistantSuggestedAction[];
  summary: string;
  title: string;
};

export type NorthstarAssistantProviderInput = {
  context: NorthstarAssistantContext;
  deterministicInsight: NorthstarAssistantInsight;
  prompt: {
    system: string;
    user: string;
  };
};

export type NorthstarAssistantProviderOutput = {
  cautions?: string[];
  confidence?: NorthstarAssistantConfidence;
  summary?: string;
};

export type NorthstarAssistantProvider = {
  explain(input: NorthstarAssistantProviderInput): Promise<NorthstarAssistantProviderOutput>;
  id: "openai";
  name: string;
};

type BuildInsightOptions = {
  env?: EnvInput;
  fetchImpl?: FetchLike;
  provider?: NorthstarAssistantProvider | null;
  useProvider?: boolean;
};

const defaultNorthstarAssistantModel = "gpt-5.5";
const maxTextLength = 700;
const maxProviderPayloadChars = 9000;
const companyFactPattern =
  /\b(account|company|contract|department|implementation|legal|msa|organization|procurement|rollout|security|sow|team|vendor)\b/i;

export function northstarAssistantReadiness(env: EnvInput = process.env): NorthstarAssistantReadiness {
  if (!readNonEmpty(env.OPENAI_API_KEY)) {
    return {
      configured: false,
      message: "Northstar Assistant AI summaries are not configured. Deterministic diagnostics still run.",
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId: "none",
      providerName: "Not configured"
    };
  }

  return {
    configured: true,
    message: "Northstar Assistant AI summaries can use OpenAI. Suggested actions remain review-first.",
    missingEnvNames: [],
    providerId: "openai",
    providerName: "OpenAI"
  };
}

export async function buildContactAssistantContext(
  actor: WorkspaceActor,
  personId: string,
  options: { now?: Date } = {}
): Promise<NorthstarAssistantContext> {
  await ensureWorkspaceAccess(actor);
  const [person, auditLogs] = await prisma.$transaction([
    prisma.person.findFirst({
      where: { id: personId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        activities: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 8 },
        deals: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: { updatedAt: "desc" }, take: 5 },
        emailLogs: { orderBy: { occurredAt: "desc" }, take: 5 },
        notes: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: { createdAt: "desc" }, take: 5 },
        organization: true,
        owner: { select: userDisplaySelect }
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: "Person", entityId: personId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);
  if (!person) throw new ApiError("NOT_FOUND", "Person was not found.", 404);

  const possibleLinks = !person.organizationId && person.email
    ? await possibleOrganizationsForEmailDomain(actor.workspaceId, person.email)
    : [];
  const personName = formatPersonName(person) ?? person.email ?? "Unnamed contact";
  return baseAssistantContext({
    audits: auditLogs.map(toAuditContext),
    generatedAt: options.now,
    lookedAt: [
      "contact identity and owner",
      "linked organization and deals",
      "follow-up activity",
      "recent notes and emails",
      "Relationship Memory fields",
      "recent change history"
    ],
    record: { id: person.id, label: personName, type: "contact" },
    related: {
      activities: person.activities.map(toActivityContext),
      connections: [],
      emails: person.emailLogs.map(toEmailContext),
      jobs: [],
      notes: person.notes.map(toNoteContext),
      possibleLinks,
      proposalSummaries: person.deals.map((deal) => `Linked deal: ${deal.title} (${deal.status})`),
      relationshipFacts: relationshipFactsFromPerson(person)
    },
    surface: "contact",
    workspaceId: actor.workspaceId
  });
}

export async function buildDealAssistantContext(
  actor: WorkspaceActor,
  dealId: string,
  options: { now?: Date } = {}
): Promise<NorthstarAssistantContext> {
  await ensureWorkspaceAccess(actor);
  const [deal, auditLogs] = await prisma.$transaction([
    prisma.deal.findFirst({
      where: { id: dealId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        activities: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }], take: 10 },
        emailLogs: { orderBy: { occurredAt: "desc" }, take: 5 },
        lineItems: { orderBy: { createdAt: "asc" }, take: 5 },
        notes: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: { createdAt: "desc" }, take: 5 },
        organization: true,
        person: true,
        quotes: { orderBy: { updatedAt: "desc" }, take: 3 },
        stage: true
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: "Deal", entityId: dealId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);
  if (!deal) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);

  const possibleLinks = deal.organization || deal.person
    ? []
    : await recentPeopleAndOrganizations(actor.workspaceId);

  return baseAssistantContext({
    audits: auditLogs.map(toAuditContext),
    generatedAt: options.now,
    lookedAt: [
      "deal status and stage",
      "customer links",
      "follow-up activity",
      "recent notes and emails",
      "quotes and line items",
      "recent change history"
    ],
    record: { id: deal.id, label: deal.title, status: deal.status, type: "deal" },
    related: {
      activities: deal.activities.map(toActivityContext),
      connections: [],
      emails: deal.emailLogs.map(toEmailContext),
      jobs: [],
      notes: deal.notes.map(toNoteContext),
      possibleLinks,
      proposalSummaries: [
        `Stage: ${deal.stage.name}`,
        `Customer: ${deal.organization?.name ?? (deal.person ? formatPersonName(deal.person) : null) ?? "not linked"}`,
        `Line items: ${deal.lineItems.length}`,
        `Quotes: ${deal.quotes.length}`
      ],
      relationshipFacts: deal.person ? relationshipFactsFromPerson(deal.person) : []
    },
    surface: "deal",
    workspaceId: actor.workspaceId
  });
}

export async function buildLeadAssistantContext(
  actor: WorkspaceActor,
  leadId: string,
  options: { now?: Date } = {}
): Promise<NorthstarAssistantContext> {
  await ensureWorkspaceAccess(actor);
  const [lead, auditLogs] = await prisma.$transaction([
    prisma.lead.findFirst({
      where: { id: leadId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        activities: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }], take: 8 },
        emailLogs: { orderBy: { occurredAt: "desc" }, take: 5 },
        notes: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: { createdAt: "desc" }, take: 5 },
        organization: true,
        person: true
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: "Lead", entityId: leadId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);
  if (!lead) throw new ApiError("NOT_FOUND", "Lead was not found.", 404);

  return baseAssistantContext({
    audits: auditLogs.map(toAuditContext),
    generatedAt: options.now,
    lookedAt: ["lead status", "contact and organization links", "follow-up activity", "notes", "emails", "recent change history"],
    record: { id: lead.id, label: lead.title, status: lead.status, type: "lead" },
    related: {
      activities: lead.activities.map(toActivityContext),
      connections: [],
      emails: lead.emailLogs.map(toEmailContext),
      jobs: [],
      notes: lead.notes.map(toNoteContext),
      possibleLinks: [],
      proposalSummaries: [
        `Source: ${lead.source ?? "not recorded"}`,
        `Contact: ${lead.person ? formatPersonName(lead.person) ?? lead.person.email ?? "Unnamed contact" : "not linked"}`,
        `Organization: ${lead.organization?.name ?? "not linked"}`
      ],
      relationshipFacts: lead.person ? relationshipFactsFromPerson(lead.person) : []
    },
    surface: "lead",
    workspaceId: actor.workspaceId
  });
}

export async function buildOrganizationAssistantContext(
  actor: WorkspaceActor,
  organizationId: string,
  options: { now?: Date } = {}
): Promise<NorthstarAssistantContext> {
  await ensureWorkspaceAccess(actor);
  const [organization, auditLogs] = await prisma.$transaction([
    prisma.organization.findFirst({
      where: { id: organizationId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        activities: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }], take: 8 },
        deals: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: { updatedAt: "desc" }, take: 5 },
        emailLogs: { orderBy: { occurredAt: "desc" }, take: 5 },
        notes: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: { createdAt: "desc" }, take: 5 },
        people: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 8 }
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: "Organization", entityId: organizationId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);
  if (!organization) throw new ApiError("NOT_FOUND", "Organization was not found.", 404);

  return baseAssistantContext({
    audits: auditLogs.map(toAuditContext),
    generatedAt: options.now,
    lookedAt: ["organization identity", "linked contacts and deals", "follow-up activity", "notes", "emails", "recent change history"],
    record: { id: organization.id, label: organization.name, type: "organization" },
    related: {
      activities: organization.activities.map(toActivityContext),
      connections: [],
      emails: organization.emailLogs.map(toEmailContext),
      jobs: [],
      notes: organization.notes.map(toNoteContext),
      possibleLinks: [],
      proposalSummaries: [
        `Domain: ${organization.domain ?? "not recorded"}`,
        `Contacts: ${organization.people.length}`,
        `Deals: ${organization.deals.length}`
      ],
      relationshipFacts: organization.people.flatMap(relationshipFactsFromPerson).slice(0, 8)
    },
    surface: "organization",
    workspaceId: actor.workspaceId
  });
}

export async function buildInboxAssistantContext(
  actor: WorkspaceActor,
  options: { now?: Date } = {}
): Promise<NorthstarAssistantContext> {
  await ensureWorkspaceAccess(actor);
  const [emailLogs, connections, jobs] = await Promise.all([
    prisma.emailLog.findMany({
      where: { workspaceId: actor.workspaceId },
      include: {
        activityLinks: { include: { activity: true } },
        deal: true,
        lead: true,
        organization: true,
        person: true
      },
      orderBy: { occurredAt: "desc" },
      take: 12
    }),
    prisma.emailConnection.findMany({
      where: { workspaceId: actor.workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.job.findMany({
      where: { workspaceId: actor.workspaceId, type: { startsWith: "email." } },
      orderBy: { updatedAt: "desc" },
      take: 10
    })
  ]);

  return baseAssistantContext({
    audits: [],
    generatedAt: options.now,
    lookedAt: [
      "recent stored email logs",
      "saved Smart Label snapshots",
      "linked follow-ups",
      "email connection health",
      "recent email sync activity"
    ],
    related: {
      activities: emailLogs.flatMap((email) => email.activityLinks.map((link) => toActivityContext(link.activity))).slice(0, 8),
      connections: connections.map(toConnectionContext),
      emails: emailLogs.map(toEmailContext),
      jobs: jobs.map(toJobContext),
      notes: [],
      possibleLinks: [],
      proposalSummaries: [`Stored email logs reviewed: ${emailLogs.length}`, `Email connection rows reviewed: ${connections.length}`],
      relationshipFacts: []
    },
    surface: "inbox",
    workspaceId: actor.workspaceId
  });
}

export async function buildMeetingIntelligenceProposalAssistantContext(
  actor: WorkspaceActor,
  intakeId: string,
  options: { now?: Date } = {}
): Promise<NorthstarAssistantContext> {
  await ensureWorkspaceAccess(actor);
  const intake = await prisma.meetingIntake.findFirst({
    where: { id: intakeId, workspaceId: actor.workspaceId },
    include: {
      meetingActivityAssociations: {
        include: {
          activity: true,
          deal: true,
          lead: true,
          organization: true,
          person: true
        },
        take: 10
      }
    }
  });
  if (!intake) throw new ApiError("NOT_FOUND", "Meeting intake was not found.", 404);

  return baseAssistantContext({
    audits: [],
    generatedAt: options.now,
    lookedAt: [
      "Meeting Intelligence status",
      "source and extraction metadata",
      "review proposal summary",
      "existing activity associations",
      "safe processing messages"
    ],
    record: { id: intake.id, label: intake.originalFilename ?? `Meeting intake ${shortId(intake.id)}`, status: intake.status, type: "lead" },
    related: {
      activities: intake.meetingActivityAssociations.map((association) => toActivityContext(association.activity)),
      connections: [],
      emails: [],
      jobs: [],
      notes: [],
      possibleLinks: intake.meetingActivityAssociations.flatMap((association) => associationLinks(association)),
      proposalSummaries: meetingProposalSummaries(intake),
      relationshipFacts: []
    },
    surface: "meeting_intelligence",
    workspaceId: actor.workspaceId
  });
}

export async function buildSystemDiagnosticAssistantContext(
  actor: WorkspaceActor,
  options: { env?: EnvInput; now?: Date } = {}
): Promise<NorthstarAssistantContext> {
  await ensureWorkspaceAccess(actor);
  const [jobs, connections, jobStatusGroups] = await Promise.all([
    prisma.job.findMany({
      where: { OR: [{ workspaceId: actor.workspaceId }, { workspaceId: null }] },
      orderBy: { updatedAt: "desc" },
      take: 20
    }),
    prisma.emailConnection.findMany({
      where: { workspaceId: actor.workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 8
    }),
    prisma.job.groupBy({
      by: ["status"],
      where: { OR: [{ workspaceId: actor.workspaceId }, { workspaceId: null }] },
      _count: { _all: true }
    })
  ]);

  return baseAssistantContext({
    audits: [],
    generatedAt: options.now,
    lookedAt: [
      "aggregate job status",
      "recent background work",
      "email connection health",
      "safe error summaries",
      "setup readiness"
    ],
    related: {
      activities: [],
      connections: connections.map(toConnectionContext),
      emails: [],
      jobs: jobs.map(toJobContext),
      notes: [],
      possibleLinks: [],
      proposalSummaries: [],
      relationshipFacts: []
    },
    surface: "job_system",
    system: {
      env: systemEnvReadiness(options.env ?? process.env),
      jobStatusCounts: Object.fromEntries(jobStatusGroups.map((group) => [group.status, group._count._all]))
    },
    workspaceId: actor.workspaceId
  });
}

export async function buildNorthstarAssistantInsight(
  context: NorthstarAssistantContext,
  options: BuildInsightOptions = {}
): Promise<NorthstarAssistantInsight> {
  const deterministicInsight = buildDeterministicInsight(context);
  if (!options.useProvider) return deterministicInsight;

  const provider = options.provider ?? createOpenAINorthstarAssistantProvider(options.env, options.fetchImpl);
  if (!provider) return deterministicInsight;

  const prompt = buildNorthstarAssistantPrompt(context, deterministicInsight);
  const generated = await provider.explain({ context, deterministicInsight, prompt });
  return {
    ...deterministicInsight,
    cautions: dedupe([...deterministicInsight.cautions, ...(generated.cautions ?? [])]),
    confidence: generated.confidence ?? deterministicInsight.confidence,
    mode: "provider",
    providerId: provider.id,
    providerName: provider.name,
    summary: truncate(generated.summary, 1200) ?? deterministicInsight.summary
  };
}

export function buildDeterministicInsight(context: NorthstarAssistantContext): NorthstarAssistantInsight {
  const findings = [
    ...recordLinkFindings(context),
    ...activityFindings(context),
    ...relationshipMemoryFindings(context),
    ...inboxFindings(context),
    ...jobAndConnectionFindings(context),
    ...meetingIntelligenceFindings(context)
  ];
  const suggestedActions = reviewFirstActionsForFindings(context, findings);
  const generatedAt = context.generatedAt;

  if (findings.length === 0) {
    return {
      cautions: defaultCautions(context),
      confidence: "medium",
      findings: [{
        detail: "Northstar did not find an obvious missing link, overdue follow-up, email follow-up gap, or misfiled update in the reviewed context.",
        evidence: context.lookedAt.slice(0, 4),
        id: "no-obvious-discrepancy",
        severity: "success",
        title: "No obvious issue found"
      }],
      generatedAt,
      guardrails: defaultGuardrails(),
      lookedAt: context.lookedAt,
      mode: "deterministic",
      providerId: "deterministic",
      providerName: "Deterministic rules",
      suggestedActions: [{
        id: "keep-reviewing",
        kind: "review_record",
        label: "Review the record normally",
        reason: "No automatic change is needed from the current diagnostic snapshot.",
        reviewFirst: true
      }],
      summary: "Northstar reviewed the available CRM context and did not find a clear issue. Continue normal review before making changes.",
      title: assistantTitle(context)
    };
  }

  return {
    cautions: defaultCautions(context),
    confidence: findings.some((finding) => finding.severity === "attention") ? "high" : "medium",
    findings,
    generatedAt,
    guardrails: defaultGuardrails(),
    lookedAt: context.lookedAt,
    mode: "deterministic",
    providerId: "deterministic",
    providerName: "Deterministic rules",
    suggestedActions,
    summary: deterministicSummary(context, findings),
    title: assistantTitle(context)
  };
}

export function buildNorthstarAssistantPrompt(
  context: NorthstarAssistantContext,
  deterministicInsight: NorthstarAssistantInsight
) {
  const system = [
    "You are Northstar Assistant, an AI operating layer for a CRM.",
    "Explain the current state using only the provided sanitized workspace-scoped context.",
    "Do not expose secrets, OAuth tokens, raw provider payloads, internal job payloads, or unrelated workspace data.",
    "Do not recommend silent mutation. Every action must stay review-first.",
    "Return strict JSON with keys: summary, confidence, cautions."
  ].join(" ");
  const user = truncate(
    JSON.stringify({
      context,
      deterministicInsight: {
        findings: deterministicInsight.findings,
        suggestedActions: deterministicInsight.suggestedActions,
        summary: deterministicInsight.summary
      }
    }),
    maxProviderPayloadChars
  ) ?? "{}";
  return { system, user };
}

export function createOpenAINorthstarAssistantProvider(
  env: EnvInput = process.env,
  fetchImpl: FetchLike = fetch
): NorthstarAssistantProvider | null {
  const apiKey = readNonEmpty(env.OPENAI_API_KEY);
  if (!apiKey) return null;

  return {
    id: "openai",
    name: "OpenAI",
    async explain(input) {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: [
            { role: "system", content: input.prompt.system },
            { role: "user", content: input.prompt.user }
          ],
          max_output_tokens: 700,
          model: defaultNorthstarAssistantModel
        })
      });
      const body = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
      if (!response.ok) {
        throw new ApiError("AI_ASSISTANT_PROVIDER_FAILED", "Northstar Assistant provider request failed.", 502);
      }
      const outputText = readNonEmpty(body?.output_text) ?? extractResponsesOutputText(body?.output) ?? readNonEmpty(body?.text);
      if (!outputText) {
        throw new ApiError("AI_ASSISTANT_EMPTY_RESULT", "Northstar Assistant provider returned no explanation.", 502);
      }
      return normalizeProviderOutput(parseProviderJson(outputText));
    }
  };
}

export function summarizeConnectionScopes(scopes: Prisma.JsonValue | null | undefined): string[] {
  const scopeText = Array.isArray(scopes)
    ? scopes.filter((scope): scope is string => typeof scope === "string").join(" ")
    : typeof scopes === "string"
      ? scopes
      : "";
  const categories = new Set<string>();
  if (/gmail\.readonly|gmail\.modify|mail\.google\.com/i.test(scopeText)) categories.add("Gmail read");
  if (/gmail\.send|mail\.google\.com/i.test(scopeText)) categories.add("Gmail send");
  if (/(^|\s)(https?:\/\/graph\.microsoft\.com\/)?(?:mail\.read|messages\.read)(\s|$)/i.test(scopeText)) {
    categories.add("Microsoft mail read");
  }
  if (/user\.read|profile|userinfo\.profile/i.test(scopeText)) categories.add("Profile");
  if (/email|userinfo\.email/i.test(scopeText)) categories.add("Email identity");
  if (categories.size === 0 && scopeText) categories.add("Provider scopes present");
  return [...categories];
}

function baseAssistantContext(input: {
  audits: NorthstarAssistantAuditContext[];
  generatedAt?: Date;
  lookedAt: string[];
  record?: NorthstarAssistantRecordSummary;
  related: NorthstarAssistantContext["related"];
  surface: NorthstarAssistantSurface;
  system?: NorthstarAssistantContext["system"];
  workspaceId: string;
}): NorthstarAssistantContext {
  return {
    audits: input.audits,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    lookedAt: input.lookedAt,
    record: input.record,
    related: input.related,
    safety: {
      excludes: [
        "OAuth access tokens",
        "OAuth refresh tokens",
        "raw provider payloads",
        "job payload internals",
        "client secrets and environment values",
        "records outside the active workspace"
      ],
      reviewFirst: true,
      workspaceScoped: true
    },
    surface: input.surface,
    system: input.system,
    workspaceId: input.workspaceId
  };
}

function recordLinkFindings(context: NorthstarAssistantContext): NorthstarAssistantFinding[] {
  const record = context.record;
  if (!record) return [];

  const possibleLinkEvidence = context.related.possibleLinks.slice(0, 3).map((link) => `${link.label}: ${link.reason}`);
  if (record.type === "contact" && possibleLinkEvidence.length > 0) {
    return [{
      detail: "This contact has no linked organization, but Northstar found same-domain organizations that may be the right account.",
      evidence: possibleLinkEvidence,
      id: "contact-missing-organization",
      severity: "warning",
      title: "Contact may be missing an organization link"
    }];
  }

  if (record.type === "deal" && context.related.proposalSummaries.some((summary) => summary === "Customer: not linked")) {
    return [{
      detail: "The deal has no linked contact or organization, so email, notes, Meeting Intelligence, and follow-up context may fragment across records.",
      evidence: context.related.possibleLinks.slice(0, 3).map((link) => `${link.label}: ${link.reason}`),
      id: "deal-missing-customer",
      severity: "attention",
      title: "Deal is missing a customer link"
    }];
  }

  if (record.type === "lead" && context.related.proposalSummaries.some((summary) => summary.endsWith("not linked"))) {
    return [{
      detail: "The lead does not have complete contact and organization links. Conversion and follow-up context may need manual review.",
      evidence: context.related.proposalSummaries.filter((summary) => summary.endsWith("not linked")),
      id: "lead-missing-links",
      severity: "warning",
      title: "Lead has incomplete CRM links"
    }];
  }

  return [];
}

function activityFindings(context: NorthstarAssistantContext): NorthstarAssistantFinding[] {
  const record = context.record;
  if (!record) return [];
  const openActivities = context.related.activities.filter((activity) => !activity.completedAt);
  const overdueActivities = openActivities.filter((activity) => activity.dueAt && new Date(activity.dueAt) < startOfDay(new Date(context.generatedAt)));

  if ((record.type === "deal" && record.status === "OPEN") || record.type === "contact" || record.type === "organization") {
    if (openActivities.length === 0) {
      return [{
        detail: "There is no open follow-up in the reviewed activity context, so the next human action is unclear.",
        evidence: [`Open activities reviewed: ${openActivities.length}`],
        id: "missing-next-activity",
        severity: "warning",
        title: "No open follow-up found"
      }];
    }
  }

  if (record.type === "deal" && record.status && record.status !== "OPEN" && openActivities.length > 0) {
    return [{
      detail: "The deal is closed but still has open follow-up activity. This may be intentional post-close work, or it may need completion/movement.",
      evidence: openActivities.slice(0, 4).map((activity) => `${activity.title}${activity.dueAt ? ` due ${activity.dueAt.slice(0, 10)}` : ""}`),
      id: "closed-deal-open-activities",
      severity: "attention",
      title: "Closed deal still has open activity"
    }];
  }

  if (record.type === "lead" && record.status === "CONVERTED" && openActivities.length > 0) {
    return [{
      detail: "Converted leads are read-only for normal follow-up. Any remaining open work should move to the converted deal/contact/organization.",
      evidence: openActivities.slice(0, 4).map((activity) => activity.title),
      id: "converted-lead-open-activities",
      severity: "attention",
      title: "Converted lead still has open activity"
    }];
  }

  if (overdueActivities.length > 0) {
    return [{
      detail: "Open activities are past due and may explain why this record appears stuck.",
      evidence: overdueActivities.slice(0, 4).map((activity) => `${activity.title} due ${activity.dueAt?.slice(0, 10)}`),
      id: "overdue-open-activities",
      severity: "warning",
      title: "Open follow-up is overdue"
    }];
  }

  return [];
}

function relationshipMemoryFindings(context: NorthstarAssistantContext): NorthstarAssistantFinding[] {
  const misplacedFacts = context.related.relationshipFacts.filter((fact) =>
    fact.field !== "relationshipInternalGuidance" && companyFactPattern.test(fact.value)
  );
  if (misplacedFacts.length === 0) return [];

  return [{
    detail: "Some Relationship Memory text looks account- or company-level rather than person-specific. Review before relying on it in contact-level AI context.",
    evidence: misplacedFacts.slice(0, 3).map((fact) => `${fact.label}: ${truncate(fact.value, 160)}`),
    id: "possible-company-fact-on-contact",
    severity: "warning",
    title: "Relationship Memory may contain company facts"
  }];
}

function inboxFindings(context: NorthstarAssistantContext): NorthstarAssistantFinding[] {
  if (context.surface !== "inbox") return [];
  const unlinkedInbound = context.related.emails.filter((email) => email.direction === "INBOUND" && !email.linkedRecordLabel);
  const needsFollowUp = context.related.emails.filter((email) =>
    email.signals.some((signal) => signal === "FOLLOW_UP_NEEDED" || signal === "NEEDS_REPLY") && (email.followUpCount ?? 0) === 0
  );

  return [
    ...(unlinkedInbound.length > 0
      ? [{
          detail: "Recent inbound email exists without a linked CRM record, which limits prioritization and follow-up creation.",
          evidence: unlinkedInbound.slice(0, 4).map((email) => email.subject),
          id: "unlinked-inbound-email",
          severity: "warning" as const,
          title: "Inbound email is missing CRM links"
        }]
      : []),
    ...(needsFollowUp.length > 0
      ? [{
          detail: "Saved labels indicate replies or follow-ups may be needed, but no reviewed follow-up was found for these messages.",
          evidence: needsFollowUp.slice(0, 4).map((email) => `${email.subject}: ${email.signals.join(", ")}`),
          id: "email-needs-follow-up-without-linked-activity",
          severity: "attention" as const,
          title: "Priority email may need a reviewed follow-up"
        }]
      : [])
  ];
}

function jobAndConnectionFindings(context: NorthstarAssistantContext): NorthstarAssistantFinding[] {
  if (context.surface !== "inbox" && context.surface !== "job_system") return [];
  const generatedAt = new Date(context.generatedAt).getTime();
  const staleRunningJobs = context.related.jobs.filter((job) =>
    job.status === "RUNNING" && job.lockedAt && generatedAt - new Date(job.lockedAt).getTime() > defaultStaleJobAfterMs
  );
  const failedJobs = context.related.jobs.filter((job) => job.status === "DEAD" || (job.status === "FAILED" && job.lastError));
  const unhealthyConnections = context.related.connections.filter((connection) =>
    connection.status !== "CONNECTED" || Boolean(connection.lastError)
  );

  return [
    ...(staleRunningJobs.length > 0
      ? [{
          detail: "A job has been running longer than the normal stale threshold. The worker may be stopped or the job may need a reviewed retry path.",
          evidence: staleRunningJobs.slice(0, 4).map((job) => `${job.type} ${shortId(job.id)} locked ${job.lockedAt}`),
          id: "stale-running-jobs",
          severity: "attention" as const,
          title: "Job may be stale"
        }]
      : []),
    ...(failedJobs.length > 0
      ? [{
          detail: "Recent jobs include failed or dead-lettered work with sanitized errors.",
          evidence: failedJobs.slice(0, 4).map((job) => `${job.type} ${job.status}: ${job.lastError ?? "no error recorded"}`),
          id: "failed-jobs",
          severity: "warning" as const,
          title: "Recent job failure needs review"
        }]
      : []),
    ...(unhealthyConnections.length > 0
      ? [{
          detail: "One or more provider connections are not in a clean connected state or have a sanitized last error.",
          evidence: unhealthyConnections.slice(0, 4).map((connection) => `${connection.provider} ${connection.status}: ${connection.lastError ?? "no error recorded"}`),
          id: "connection-readiness-issue",
          severity: "warning" as const,
          title: "Connection readiness issue"
        }]
      : [])
  ];
}

function meetingIntelligenceFindings(context: NorthstarAssistantContext): NorthstarAssistantFinding[] {
  if (context.surface !== "meeting_intelligence") return [];
  const warnings = context.related.proposalSummaries.filter((summary) => /warning|uncertain|failed|error|required/i.test(summary));
  if (warnings.length === 0) return [];

  return [{
    detail: "The Meeting Intelligence proposal includes warnings or uncertain routing. Review targets before applying any update.",
    evidence: warnings.slice(0, 5),
    id: "meeting-proposal-needs-target-review",
    severity: "attention",
    title: "Meeting proposal target review needed"
  }];
}

function reviewFirstActionsForFindings(
  context: NorthstarAssistantContext,
  findings: NorthstarAssistantFinding[]
): NorthstarAssistantSuggestedAction[] {
  const actions = findings.map((finding): NorthstarAssistantSuggestedAction => {
    if (finding.id.includes("missing-organization") || finding.id.includes("missing-customer") || finding.id.includes("missing-links") || finding.id.includes("unlinked")) {
      return {
        href: recordHref(context.record),
        id: `${finding.id}-link-action`,
        kind: "link_record_proposal",
        label: "Review and link the right CRM record",
        reason: finding.detail,
        reviewFirst: true
      };
    }
    if (finding.id.includes("open-activities") || finding.id.includes("overdue")) {
      return {
        href: recordHref(context.record, "#activities"),
        id: `${finding.id}-activity-action`,
        kind: "mark_activity_complete_proposal",
        label: "Review open activities",
        reason: "Decide whether to complete, reschedule, or move the activity. Northstar will not change it automatically.",
        reviewFirst: true
      };
    }
    if (finding.id.includes("missing-next-activity") || finding.id.includes("follow-up")) {
      return {
        href: recordHref(context.record, "#add-activity"),
        id: `${finding.id}-create-activity-action`,
        kind: "create_activity_proposal",
        label: "Draft a reviewed follow-up",
        reason: "Create an activity only after checking the source context.",
        reviewFirst: true
      };
    }
    if (finding.id.includes("company-fact")) {
      return {
        href: recordHref(context.record, "#relationship-brief"),
        id: `${finding.id}-move-fact-action`,
        kind: "move_fact_proposal",
        label: "Review fact placement",
        reason: "Move or rewrite the fact only after confirming whether it belongs to the person or organization.",
        reviewFirst: true
      };
    }
    if (finding.id.includes("connection")) {
      return {
        href: "/settings#email-connections",
        id: `${finding.id}-reconnect-action`,
        kind: "reconnect_guidance",
        label: "Review connection setup",
        reason: "Check provider readiness and reconnect only through the normal settings flow.",
        reviewFirst: true
      };
    }
    if (finding.id.includes("job")) {
      return {
        id: `${finding.id}-retry-action`,
        kind: "retry_sync_proposal",
        label: "Review job status before retrying",
        reason: "Retry only through an explicit user/admin action after reading the sanitized error.",
        reviewFirst: true
      };
    }
    return {
      href: recordHref(context.record),
      id: `${finding.id}-review-action`,
      kind: "review_record",
      label: "Review before applying changes",
      reason: finding.detail,
      reviewFirst: true
    };
  });

  return uniqueActions(actions);
}

function deterministicSummary(context: NorthstarAssistantContext, findings: NorthstarAssistantFinding[]) {
  const primary = findings[0];
  const target = context.record?.label ?? surfaceLabel(context.surface);
  const extraCount = findings.length > 1 ? ` Northstar found ${findings.length - 1} additional item${findings.length === 2 ? "" : "s"} to review.` : "";
  return `${target}: ${primary.title}. ${primary.detail}${extraCount}`;
}

function assistantTitle(context: NorthstarAssistantContext) {
  if (context.record) return `Northstar Assistant for ${context.record.label}`;
  return `Northstar Assistant for ${surfaceLabel(context.surface)}`;
}

function defaultCautions(context: NorthstarAssistantContext) {
  return [
    "Suggestions are review-first and do not change CRM records automatically.",
      "The assistant only used context from this workspace.",
    context.surface === "job_system" || context.surface === "inbox"
      ? "Diagnostics hide private connection data and raw provider details."
      : "Record guidance should be checked against the source notes, emails, activities, and audit history before applying."
  ];
}

function defaultGuardrails() {
  return [
    "No automatic changes",
    "Current workspace only",
    "Private connection data hidden",
    "Review before apply"
  ];
}

async function possibleOrganizationsForEmailDomain(workspaceId: string, email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return [];
  const organizations = await prisma.organization.findMany({
    where: { workspaceId, ...activeWhere, domain: { equals: domain, mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
    take: 3
  });
  return organizations.map((organization) => ({
    id: organization.id,
    label: organization.name,
    reason: `Email domain ${domain} matches organization domain`,
    type: "organization" as const
  }));
}

async function recentPeopleAndOrganizations(workspaceId: string) {
  const [people, organizations] = await Promise.all([
    prisma.person.findMany({ where: { workspaceId, ...activeWhere }, orderBy: { updatedAt: "desc" }, take: 3 }),
    prisma.organization.findMany({ where: { workspaceId, ...activeWhere }, orderBy: { updatedAt: "desc" }, take: 3 })
  ]);
  return [
    ...people.map((person) => ({
      id: person.id,
      label: formatPersonName(person) ?? person.email ?? "Unnamed contact",
      reason: "Recently updated contact in this workspace",
      type: "contact" as const
    })),
    ...organizations.map((organization) => ({
      id: organization.id,
      label: organization.name,
      reason: "Recently updated organization in this workspace",
      type: "organization" as const
    }))
  ];
}

function toActivityContext(activity: {
  completedAt: Date | string | null;
  dueAt: Date | string | null;
  id: string;
  title: string;
  type: string;
}): NorthstarAssistantActivityContext {
  return {
    completedAt: dateToIso(activity.completedAt),
    dueAt: dateToIso(activity.dueAt),
    id: activity.id,
    title: truncate(activity.title, 240) ?? "Untitled activity",
    type: activity.type
  };
}

function toAuditContext(audit: {
  action: string;
  actor?: { email: string; name: string | null } | null;
  createdAt: Date | string;
  entityType: string;
  id: string;
  metadata?: Prisma.JsonValue | null;
}): NorthstarAssistantAuditContext {
  return {
    action: audit.action,
    actorLabel: audit.actor?.name ?? audit.actor?.email ?? undefined,
    createdAt: dateToIso(audit.createdAt) ?? new Date(0).toISOString(),
    entityType: audit.entityType,
    id: audit.id,
    metadataSummary: summarizeJson(audit.metadata)
  };
}

function toConnectionContext(connection: {
  accountEmail: string | null;
  createdAt: Date | string;
  id: string;
  lastError: string | null;
  lastSyncAt: Date | string | null;
  provider: EmailConnectionProvider;
  scopes: Prisma.JsonValue | null;
  status: EmailConnectionStatus;
  updatedAt: Date | string;
}): NorthstarAssistantConnectionContext {
  return {
    accountEmail: connection.accountEmail,
    createdAt: dateToIso(connection.createdAt) ?? new Date(0).toISOString(),
    id: connection.id,
    lastError: sanitizeDiagnosticText(connection.lastError),
    lastSyncAt: dateToIso(connection.lastSyncAt),
    provider: connection.provider,
    scopeCategories: summarizeConnectionScopes(connection.scopes),
    status: connection.status,
    updatedAt: dateToIso(connection.updatedAt) ?? new Date(0).toISOString()
  };
}

function toEmailContext(email: {
  activityLinks?: Array<{ activity?: unknown }>;
  deal?: { title: string } | null;
  direction: string;
  id: string;
  lead?: { title: string } | null;
  occurredAt: Date | string;
  organization?: { name: string } | null;
  person?: { email: string | null; firstName: string; lastName: string | null } | null;
  provider?: EmailConnectionProvider | null;
  smartLabelGeneratedAt?: Date | string | null;
  smartLabelJson?: Prisma.JsonValue | null;
  smartLabelProvider?: string | null;
  subject: string;
}): NorthstarAssistantEmailContext {
  const classification = readEmailSmartClassification({
    smartLabelGeneratedAt: email.smartLabelGeneratedAt,
    smartLabelJson: email.smartLabelJson,
    smartLabelProvider: email.smartLabelProvider
  });
  return {
    classificationSummary: classification?.summary ? truncate(classification.summary, 260) : undefined,
    direction: email.direction,
    followUpCount: email.activityLinks?.length,
    id: email.id,
    linkedRecordLabel: email.deal?.title ??
      email.lead?.title ??
      email.organization?.name ??
      (email.person ? formatPersonName(email.person) ?? email.person.email ?? undefined : undefined),
    occurredAt: dateToIso(email.occurredAt) ?? new Date(0).toISOString(),
    provider: email.provider,
    signals: classification?.signals ?? [],
    subject: truncate(email.subject, 240) ?? "Untitled email"
  };
}

function toJobContext(job: {
  attempts: number;
  createdAt: Date | string;
  failedAt: Date | string | null;
  id: string;
  lastError: string | null;
  lockedAt: Date | string | null;
  maxAttempts: number;
  processedAt: Date | string | null;
  runAt: Date | string;
  status: JobStatus;
  type: string;
  updatedAt: Date | string;
}): NorthstarAssistantJobContext {
  return {
    attempts: job.attempts,
    createdAt: dateToIso(job.createdAt) ?? new Date(0).toISOString(),
    failedAt: dateToIso(job.failedAt),
    id: job.id,
    lastError: sanitizeDiagnosticText(job.lastError),
    lockedAt: dateToIso(job.lockedAt),
    maxAttempts: job.maxAttempts,
    processedAt: dateToIso(job.processedAt),
    runAt: dateToIso(job.runAt) ?? new Date(0).toISOString(),
    status: job.status,
    type: job.type,
    updatedAt: dateToIso(job.updatedAt) ?? new Date(0).toISOString()
  };
}

function toNoteContext(note: { body: string; createdAt: Date | string; id: string }) {
  return {
    body: truncate(note.body, maxTextLength) ?? "",
    createdAt: dateToIso(note.createdAt) ?? new Date(0).toISOString(),
    id: note.id
  };
}

function relationshipFactsFromPerson(person: {
  relationshipBusinessConcerns?: string | null;
  relationshipCommunicationStyle?: string | null;
  relationshipFollowUpReminders?: string | null;
  relationshipInternalGuidance?: string | null;
  relationshipPersonalContext?: string | null;
}) {
  const entries: Array<[RelationshipBriefFieldKey, string | null | undefined]> = [
    ["relationshipPersonalContext", person.relationshipPersonalContext],
    ["relationshipCommunicationStyle", person.relationshipCommunicationStyle],
    ["relationshipBusinessConcerns", person.relationshipBusinessConcerns],
    ["relationshipFollowUpReminders", person.relationshipFollowUpReminders],
    ["relationshipInternalGuidance", person.relationshipInternalGuidance]
  ];
  return entries.flatMap(([field, value]) => {
    const trimmed = value?.trim();
    if (!trimmed) return [];
    return [{
      field,
      label: relationshipBriefUsageForField(field).label,
      value: truncate(trimmed, maxTextLength) ?? trimmed
    }];
  });
}

function meetingProposalSummaries(intake: {
  applyResultJson: Prisma.JsonValue | null;
  errorMessage: string | null;
  originalFilename: string | null;
  originalMimeType: string | null;
  proposedChangesJson: Prisma.JsonValue | null;
  sourceType: string;
  status: string;
}) {
  return [
    `Status: ${intake.status}`,
    `Source type: ${intake.sourceType}`,
    intake.originalFilename ? `Original filename: ${truncate(intake.originalFilename, 180)}` : null,
    intake.originalMimeType ? `Original MIME type: ${intake.originalMimeType}` : null,
    intake.errorMessage ? `Processor warning/error: ${sanitizeDiagnosticText(intake.errorMessage)}` : null,
    ...summarizeProposalJson(intake.proposedChangesJson),
    ...summarizeProposalJson(intake.applyResultJson).map((summary) => `Apply result: ${summary}`)
  ].filter((summary): summary is string => Boolean(summary));
}

function summarizeProposalJson(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object") return [];
  const text = JSON.stringify(value);
  const summaries = [];
  const noteCount = countMatches(text, /"notes?"\s*:/gi);
  const activityCount = countMatches(text, /"activit(?:y|ies)"\s*:/gi);
  const relationshipCount = countMatches(text, /relationshipBrief|Relationship Brief|relationship/i);
  const warningCount = countMatches(text, /warning|uncertain|skipped|failed|error|required/gi);
  if (noteCount > 0) summaries.push(`Note proposal groups: ${noteCount}`);
  if (activityCount > 0) summaries.push(`Activity proposal groups: ${activityCount}`);
  if (relationshipCount > 0) summaries.push(`Relationship Memory proposal signals: ${relationshipCount}`);
  if (warningCount > 0) summaries.push(`Warnings or uncertain results: ${warningCount}`);
  return summaries.length > 0 ? summaries : [`Proposal JSON present (${Math.min(text.length, maxTextLength)} chars summarized)`];
}

function associationLinks(association: {
  deal?: { id: string; title: string } | null;
  lead?: { id: string; title: string } | null;
  organization?: { id: string; name: string } | null;
  person?: { email: string | null; firstName: string; id: string; lastName: string | null } | null;
}) {
  return [
    association.deal ? { id: association.deal.id, label: association.deal.title, reason: "Existing meeting association", type: "deal" as const } : null,
    association.lead ? { id: association.lead.id, label: association.lead.title, reason: "Existing meeting association", type: "lead" as const } : null,
    association.organization ? { id: association.organization.id, label: association.organization.name, reason: "Existing meeting association", type: "organization" as const } : null,
    association.person ? { id: association.person.id, label: formatPersonName(association.person) ?? association.person.email ?? "Unnamed contact", reason: "Existing meeting association", type: "contact" as const } : null
  ].filter((link): link is NonNullable<typeof link> => Boolean(link));
}

function systemEnvReadiness(env: EnvInput) {
  return [
    {
      configured: Boolean(readNonEmpty(env.OPENAI_API_KEY)),
      key: "openai" as const,
      label: "OpenAI provider"
    },
    {
      configured: Boolean(readNonEmpty(env.EMAIL_TOKEN_ENCRYPTION_KEY)),
      key: "email_token_encryption" as const,
      label: "Email token encryption"
    },
    {
      configured: Boolean(
        (readNonEmpty(env.GOOGLE_CLIENT_ID) && readNonEmpty(env.GOOGLE_CLIENT_SECRET)) ||
        (readNonEmpty(env.MICROSOFT_CLIENT_ID) && readNonEmpty(env.MICROSOFT_CLIENT_SECRET))
      ),
      key: "email_oauth" as const,
      label: "Email OAuth client configuration"
    },
    {
      configured: readNonEmpty(env.RAILWAY_SERVICE_ROLE) === "worker" || readNonEmpty(env.NORTHSTAR_WORKER_ENABLED) === "1",
      key: "worker" as const,
      label: "Continuous worker indicator"
    }
  ];
}

function normalizeProviderOutput(value: unknown): NorthstarAssistantProviderOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    cautions: Array.isArray(input.cautions)
      ? input.cautions.filter((item): item is string => typeof item === "string").map((item) => truncate(item, 240) ?? item).slice(0, 4)
      : undefined,
    confidence: input.confidence === "high" || input.confidence === "medium" || input.confidence === "low" ? input.confidence : undefined,
    summary: typeof input.summary === "string" ? input.summary : undefined
  };
}

function parseProviderJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function extractResponsesOutputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return undefined;
}

function summarizeJson(value: Prisma.JsonValue | null | undefined) {
  if (!value) return undefined;
  return truncate(sanitizeDiagnosticText(JSON.stringify(value)), 500);
}

function sanitizeDiagnosticText(value: string | null | undefined) {
  const redacted = redactSensitiveText(value ?? "").trim();
  return redacted ? truncate(redacted, 600) ?? redacted : null;
}

function recordHref(record: NorthstarAssistantRecordSummary | undefined, hash = "") {
  if (!record) return undefined;
  const base = record.type === "contact"
    ? `/contacts/${record.id}`
    : record.type === "deal"
      ? `/deals/${record.id}`
      : record.type === "lead"
        ? `/leads/${record.id}`
        : `/organizations/${record.id}`;
  return `${base}${hash}`;
}

function surfaceLabel(surface: NorthstarAssistantSurface) {
  return surface
    .replace("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateToIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function truncate(value: string | null | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueActions(actions: NorthstarAssistantSuggestedAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}:${action.label}:${action.href ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

type OpenAIResponseBody = {
  output?: unknown;
  output_text?: unknown;
  text?: unknown;
};
