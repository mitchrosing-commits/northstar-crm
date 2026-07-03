import { MeetingIntakeSourceType, MeetingIntakeStatus, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { extractMeetingText } from "@/lib/meeting-intelligence/extractors";
import { normalizeMeetingMarkdown } from "@/lib/meeting-intelligence/markdown-normalizer";
import { unsupportedVideoError } from "@/lib/meeting-intelligence/openai-media-provider";
import {
  createConfiguredMeetingMediaProvider,
  getMeetingMediaProviderReadiness,
  isMediaProviderSourceType,
  mediaProviderRequiredMessage,
  meetingMediaExtractionJobType,
  type MediaExtractionProvider
} from "@/lib/meeting-intelligence/media-providers";
import { matchMeetingCrmObjects, type MatchRecordHints } from "@/lib/meeting-intelligence/match-records";
import { deterministicMeetingAnalysisProvider } from "@/lib/meeting-intelligence/providers";
import { detectMeetingSource, normalizeSourceType } from "@/lib/meeting-intelligence/source-detection";
import type {
  ApplyMeetingIntelligenceInput,
  ApplyMeetingIntelligenceResult,
  CrmTarget,
  ExtractedMeetingText,
  MeetingIntelligenceDraft,
  MeetingSourceConversionMode,
  MeetingSourceProviderRequirement,
  ProcessorCapability,
  SourceDetectionResult,
  MeetingSourceType
} from "@/lib/meeting-intelligence/types";
import { redactSensitiveText } from "@/lib/security/redaction";

import { createActivity } from "./activity-service";
import { createNote } from "./note-service";
import { enqueueJob } from "./job-service";
import { userDisplaySelect } from "./user-select";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

type CreateMeetingIntakeInput = {
  contextText?: unknown;
  explicitSourceType?: unknown;
  fileBase64?: unknown;
  fileText?: unknown;
  originalFilename?: unknown;
  originalMimeType?: unknown;
  text?: unknown;
  hints?: unknown;
};

type NormalizedCreateMeetingIntakeInput = ReturnType<typeof normalizeCreateMeetingIntakeInput>;

export type MeetingMediaExtractionJobPayload = {
  actorUserId: string;
  contextText?: string;
  fileBase64: string;
  hints?: MatchRecordHints;
  intakeId: string;
  originalFilename?: string;
  originalMimeType?: string;
  sourceType: "audio" | "image" | "video";
  workspaceId: string;
};

export async function listMeetingIntakes(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  return prisma.meetingIntake.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20
  });
}

export async function getMeetingIntake(actor: WorkspaceActor, intakeId: string) {
  await ensureWorkspaceAccess(actor);
  const intake = await prisma.meetingIntake.findFirst({
    where: { id: intakeId, workspaceId: actor.workspaceId }
  });
  if (!intake) throw new ApiError("NOT_FOUND", "Meeting intake was not found.", 404);
  return intake;
}

export async function getMeetingIntelligenceOptions(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  const [deals, leads, people, organizations, workspace] = await Promise.all([
    prisma.deal.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      orderBy: { updatedAt: "desc" },
      take: 100
    }),
    prisma.lead.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      orderBy: { updatedAt: "desc" },
      take: 100
    }),
    prisma.person.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200
    }),
    prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      orderBy: { name: "asc" },
      take: 200
    }),
    prisma.workspace.findFirstOrThrow({
      where: { id: actor.workspaceId },
      include: {
        memberships: {
          where: { user: { deletedAt: null } },
          include: { user: { select: userDisplaySelect } },
          orderBy: { createdAt: "asc" }
        }
      }
    })
  ]);

  return {
    deals: deals.map((deal) => ({ id: deal.id, label: deal.status === "OPEN" ? deal.title : `${deal.title} (${deal.status})` })),
    leads: leads.map((lead) => ({ id: lead.id, label: lead.status === "CONVERTED" ? `${lead.title} (CONVERTED)` : lead.title })),
    organizations: organizations.map((organization) => ({ id: organization.id, label: organization.name })),
    people: people.map((person) => ({ id: person.id, label: formatPersonName(person) ?? person.email ?? "Unnamed contact" })),
    users: workspace.memberships.map((membership) => ({ id: membership.user.id, label: membership.user.name ?? membership.user.email }))
  };
}

export async function createMeetingIntake(actor: WorkspaceActor, data: CreateMeetingIntakeInput) {
  await ensureWorkspaceAccess(actor);
  const input = normalizeCreateMeetingIntakeInput(data);
  assertMeetingIntakeHasSource(input);
  const detection = detectMeetingSource({
    explicitSourceType: input.explicitSourceType,
    filename: input.originalFilename,
    mimeType: input.originalMimeType,
    text: input.fileText ?? input.text
  });
  const intake = await prisma.meetingIntake.create({
    data: {
      workspaceId: actor.workspaceId,
      createdById: actor.actorUserId,
      sourceType: toPrismaSourceType(detection.sourceType),
      originalFilename: input.originalFilename,
      originalMimeType: input.originalMimeType,
      contextText: input.contextText,
      status: MeetingIntakeStatus.EXTRACTING
    }
  });

  if (isMediaProviderSourceType(detection.sourceType)) {
    return queueOrFailMediaMeetingIntake(
      actor,
      intake.id,
      input,
      detection as SourceDetectionResult & { sourceType: "audio" | "image" | "video" }
    );
  }

  try {
    const extracted = await extractMeetingText({
      explicitSourceType: detection.sourceType,
      fileBase64: input.fileBase64,
      fileText: input.fileText,
      filename: input.originalFilename,
      mimeType: input.originalMimeType,
      text: input.text
    });
    const updated = await finishMeetingIntakeExtraction(actor, intake.id, input, detection, extracted);
    await writeAuditLog(actor, "meeting_intake.created", "MeetingIntake", intake.id, {
      sourceType: detection.sourceType,
      status: updated.status
    });
    return updated;
  } catch (error) {
    const failed = await failMeetingIntake(intake.id, input, detection, error);
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intake.id, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }
}

async function queueOrFailMediaMeetingIntake(
  actor: WorkspaceActor,
  intakeId: string,
  input: NormalizedCreateMeetingIntakeInput,
  detection: SourceDetectionResult & { sourceType: "audio" | "image" | "video" }
) {
  const providerReadiness = getMeetingMediaProviderReadiness();
  if (!input.fileBase64) {
    const failed = await failMeetingIntake(
      intakeId,
      input,
      detection,
      new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${detection.sourceType.toUpperCase()} extraction requires uploaded file content.`, 422)
    );
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  if (!providerReadiness.configured) {
    const failed = await failMeetingIntake(
      intakeId,
      input,
      detection,
      new ApiError("MEETING_INTAKE_PROVIDER_NOT_CONFIGURED", mediaProviderRequiredMessage(detection.sourceType), 422)
    );
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  if (!providerReadiness.supportedSourceTypes.includes(detection.sourceType)) {
    const failed = await failMeetingIntake(
      intakeId,
      input,
      detection,
      detection.sourceType === "video"
        ? unsupportedVideoError()
        : new ApiError("MEETING_INTAKE_PROVIDER_UNAVAILABLE", mediaProviderRequiredMessage(detection.sourceType), 422)
    );
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  const job = await enqueueJob({
    dedupeKey: `meeting-intake:${intakeId}:extract-media`,
    maxAttempts: 3,
    payload: toJson({
      actorUserId: actor.actorUserId,
      contextText: input.contextText,
      fileBase64: input.fileBase64,
      hints: input.hints,
      intakeId,
      originalFilename: input.originalFilename,
      originalMimeType: input.originalMimeType,
      sourceType: detection.sourceType,
      workspaceId: actor.workspaceId
    }),
    type: meetingMediaExtractionJobType,
    workspaceId: actor.workspaceId
  });
  const queued = await prisma.meetingIntake.update({
    where: { id: intakeId },
    data: {
      analysisJson: toJson({
        detection,
        processorStatus: buildProcessorStatus(detection, input, {
          message: `Queued for ${providerReadiness.providerName ?? "media provider"} extraction.`
        }),
        providerReadiness,
        queuedJobId: job.id
      }),
      status: MeetingIntakeStatus.EXTRACTING
    }
  });
  await writeAuditLog(actor, "meeting_intake.extraction_queued", "MeetingIntake", intakeId, {
    jobId: job.id,
    providerId: providerReadiness.providerId,
    sourceType: detection.sourceType
  });
  return queued;
}

export async function processMeetingIntakeMediaExtractionJob(
  payload: unknown,
  options: { mediaProvider?: MediaExtractionProvider | null } = {}
) {
  const input = parseMeetingMediaExtractionJobPayload(payload);
  const actor = { actorUserId: input.actorUserId, workspaceId: input.workspaceId };
  await ensureWorkspaceAccess(actor);
  const intake = await prisma.meetingIntake.findFirst({
    where: { id: input.intakeId, workspaceId: input.workspaceId },
    select: { id: true, status: true }
  });
  if (!intake) throw new Error("Invalid meeting media extraction job payload.");
  if (intake.status === MeetingIntakeStatus.READY_FOR_REVIEW || intake.status === MeetingIntakeStatus.APPLIED) return;

  const normalizedInput: NormalizedCreateMeetingIntakeInput = {
    contextText: input.contextText,
    explicitSourceType: input.sourceType,
    fileBase64: input.fileBase64,
    fileText: undefined,
    hints: input.hints ?? {},
    originalFilename: input.originalFilename,
    originalMimeType: input.originalMimeType,
    text: undefined
  };
  const detection = detectMeetingSource({
    explicitSourceType: input.sourceType,
    filename: input.originalFilename,
    mimeType: input.originalMimeType
  }) as SourceDetectionResult & { sourceType: "audio" | "image" | "video" };

  await prisma.meetingIntake.update({
    where: { id: intake.id },
    data: {
      analysisJson: toJson({
        detection,
        processorStatus: buildProcessorStatus(detection, normalizedInput, { message: "Provider extraction is running." })
      }),
      errorMessage: null,
      status: MeetingIntakeStatus.EXTRACTING
    }
  });

  try {
    const mediaProvider = options.mediaProvider ?? createConfiguredMeetingMediaProvider();
    const extracted = await extractMeetingText(
      {
        explicitSourceType: detection.sourceType,
        fileBase64: input.fileBase64,
        filename: input.originalFilename,
        mimeType: input.originalMimeType
      },
      { mediaProvider }
    );
    const updated = await finishMeetingIntakeExtraction(actor, intake.id, normalizedInput, detection, extracted);
    await writeAuditLog(actor, "meeting_intake.created", "MeetingIntake", intake.id, {
      sourceType: detection.sourceType,
      status: updated.status
    });
  } catch (error) {
    await failMeetingIntake(intake.id, normalizedInput, detection, error);
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intake.id, {
      sourceType: detection.sourceType,
      message: formatMeetingIntakeFailureMessage(error)
    });
    throw error;
  }
}

async function finishMeetingIntakeExtraction(
  actor: WorkspaceActor,
  intakeId: string,
  input: NormalizedCreateMeetingIntakeInput,
  detection: SourceDetectionResult,
  extracted: ExtractedMeetingText
) {
  const normalized = normalizeMeetingMarkdown({
    contextText: input.contextText,
    metadata: extracted.metadata,
    originalFilename: input.originalFilename,
    rawText: extracted.rawText,
    sourceType: extracted.sourceType
  });
  await prisma.meetingIntake.update({
    where: { id: intakeId },
    data: {
      errorMessage: null,
      markdownText: normalized.markdown,
      rawText: extracted.rawText,
      status: MeetingIntakeStatus.ANALYZING
    }
  });
  const matches = await matchMeetingCrmObjects(actor, {
    contextText: input.contextText,
    hints: input.hints,
    markdownText: normalized.markdown
  });
  const draft = await deterministicMeetingAnalysisProvider.analyzeMeetingMarkdown({
    contextText: input.contextText,
    markdown: normalized.markdown,
    sourceMetadata: extracted.metadata,
    ...matches
  });
  draft.warnings = [...extracted.warnings, ...draft.warnings];
  return prisma.meetingIntake.update({
    where: { id: intakeId },
    data: {
      analysisJson: toJson({
        detection,
        extractionWarnings: extracted.warnings,
        metadata: extracted.metadata,
        processorStatus: buildProcessorStatus(detection, input, { extracted }),
        sections: normalized.sections
      }),
      proposedChangesJson: toJson(draft),
      status: MeetingIntakeStatus.READY_FOR_REVIEW
    }
  });
}

async function failMeetingIntake(
  intakeId: string,
  input: NormalizedCreateMeetingIntakeInput,
  detection: SourceDetectionResult,
  error: unknown
) {
  const message = formatMeetingIntakeFailureMessage(error);
  return prisma.meetingIntake.update({
    where: { id: intakeId },
    data: {
      analysisJson: toJson({
        detection,
        failureCode: error instanceof ApiError ? error.code : undefined,
        processorStatus: buildProcessorStatus(detection, input, { error, message })
      }),
      errorMessage: message,
      status: MeetingIntakeStatus.FAILED
    }
  });
}

export async function applyMeetingIntake(actor: WorkspaceActor, intakeId: string, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const intake = await getMeetingIntake(actor, intakeId);
  if (intake.status === MeetingIntakeStatus.APPLIED && intake.applyResultJson) {
    return intake.applyResultJson as ApplyMeetingIntelligenceResult;
  }
  if (intake.status !== MeetingIntakeStatus.READY_FOR_REVIEW) {
    throw new ApiError("MEETING_INTAKE_NOT_READY", "Meeting intake is not ready to apply.", 409);
  }

  const draft = parseDraft(intake.proposedChangesJson);
  const approved = normalizeApplyInput(data, draft);
  const result: ApplyMeetingIntelligenceResult = {
    appliedAt: new Date().toISOString(),
    created: [],
    skipped: [],
    warnings: [...draft.warnings]
  };

  if (approved.meetingActivity?.include) {
    await createApprovedMeetingActivity(actor, intakeId, approved.meetingActivity, result);
  }
  for (const note of approved.notes ?? []) {
    if (!note.include) {
      result.skipped.push({ label: targetLabel(note.target, "note"), reason: "Not selected for apply.", type: "note" });
      continue;
    }
    await createApprovedNote(actor, note, result);
  }
  for (const activity of approved.nextStepActivities ?? []) {
    if (!activity.include) {
      result.skipped.push({ label: activity.title, reason: "Not selected for apply.", type: "activity" });
      continue;
    }
    await createApprovedActivity(actor, activity, result, "next-step activity");
  }

  await prisma.meetingIntake.update({
    where: { id: intake.id },
    data: {
      appliedAt: new Date(result.appliedAt),
      applyResultJson: toJson(result),
      status: MeetingIntakeStatus.APPLIED
    }
  });
  await writeAuditLog(actor, "meeting_intake.applied", "MeetingIntake", intake.id, {
    createdCount: result.created.length,
    skippedCount: result.skipped.length
  });
  return result;
}

async function createApprovedNote(
  actor: WorkspaceActor,
  note: NonNullable<ApplyMeetingIntelligenceInput["notes"]>[number],
  result: ApplyMeetingIntelligenceResult
) {
  const targetValidation = await validateApplyTarget(actor, note.target);
  if (!targetValidation.target) {
    result.skipped.push({
      label: targetLabel(note.target, "note"),
      reason: targetValidation.reason ?? "No target record was selected.",
      type: "note"
    });
    return;
  }
  try {
    const created = await createNote(actor, {
      ...targetAttachment(targetValidation.target),
      body: note.body
    });
    result.created.push({
      href: targetHref(targetValidation.target),
      id: created.id,
      label: targetLabel(targetValidation.target, "note"),
      type: "note"
    });
  } catch (error) {
    result.skipped.push({
      label: targetLabel(targetValidation.target, "note"),
      reason: formatMeetingIntakeFailureMessage(error, "Could not create note."),
      type: "note"
    });
  }
}

async function createApprovedMeetingActivity(
  actor: WorkspaceActor,
  intakeId: string,
  activity: NonNullable<ApplyMeetingIntelligenceInput["meetingActivity"]>,
  result: ApplyMeetingIntelligenceResult
) {
  const created = await createApprovedActivity(actor, activity, result, "meeting activity");
  if (!created) return;
  await createApprovedMeetingAssociations(actor, intakeId, created.id, activity, result);
}

async function createApprovedActivity(
  actor: WorkspaceActor,
  activity: NonNullable<ApplyMeetingIntelligenceInput["meetingActivity"]> | NonNullable<ApplyMeetingIntelligenceInput["nextStepActivities"]>[number],
  result: ApplyMeetingIntelligenceResult,
  label: string
) {
  const targetValidation = await validateApplyTarget(actor, activity.target);
  if (!targetValidation.target) {
    result.skipped.push({
      label: activity.title || label,
      reason: targetValidation.reason ?? "No target record was selected.",
      type: "activity"
    });
    return null;
  }
  try {
    const created = await createActivity(actor, {
      ...targetAttachment(targetValidation.target),
      completedAt: "completedAt" in activity ? activity.completedAt ?? null : null,
      description: activity.description ?? null,
      dueAt: "dueAt" in activity ? activity.dueAt ?? null : null,
      ownerId: "ownerId" in activity ? activity.ownerId ?? null : null,
      title: activity.title,
      type: "type" in activity ? activity.type : "MEETING"
    });
    result.created.push({
      href: `/activities/${created.id}/edit`,
      id: created.id,
      label: created.title,
      type: "activity"
    });
    return created;
  } catch (error) {
    result.skipped.push({
      label: activity.title,
      reason: formatMeetingIntakeFailureMessage(error, "Could not create activity."),
      type: "activity"
    });
    return null;
  }
}

async function createApprovedMeetingAssociations(
  actor: WorkspaceActor,
  intakeId: string,
  activityId: string,
  activity: NonNullable<ApplyMeetingIntelligenceInput["meetingActivity"]>,
  result: ApplyMeetingIntelligenceResult
) {
  const requestedTargets = uniqueTargets([activity.target, ...(activity.associatedTargets ?? [])]);
  const validTargets: CrmTarget[] = [];

  for (const target of requestedTargets) {
    const targetValidation = await validateApplyTarget(actor, target);
    if (!targetValidation.target) {
      result.skipped.push({
        label: targetLabel(target, "meeting association"),
        reason: targetValidation.reason ?? "No target record was selected.",
        type: "activity"
      });
      continue;
    }
    validTargets.push(targetValidation.target);
  }

  if (validTargets.length === 0) return;
  const rows = uniqueTargets(validTargets).map((target) => ({
    ...targetAssociation(target),
    activityId,
    meetingIntakeId: intakeId,
    workspaceId: actor.workspaceId
  }));

  await prisma.meetingActivityAssociation.createMany({ data: rows, skipDuplicates: true });
  await writeAuditLog(actor, "meeting_activity.associations.created", "Activity", activityId, {
    associationCount: rows.length,
    meetingIntakeId: intakeId
  });
}

async function validateApplyTarget(actor: WorkspaceActor, target: CrmTarget | null | undefined) {
  if (!target) {
    return { reason: "No target record was selected.", target: null };
  }

  if (target.type === "deal") {
    const deal = await prisma.deal.findFirst({
      where: { id: target.id, workspaceId: actor.workspaceId, deletedAt: null },
      select: { id: true, status: true, title: true }
    });
    if (!deal) return { reason: "Selected target is not available in this workspace.", target: null };
    if (deal.status !== "OPEN") return { reason: "Closed deals cannot be edited.", target: null };
    return { target: { id: deal.id, label: deal.title, type: "deal" as const } };
  }

  if (target.type === "lead") {
    const lead = await prisma.lead.findFirst({
      where: { id: target.id, workspaceId: actor.workspaceId, deletedAt: null },
      select: { id: true, status: true, title: true }
    });
    if (!lead) return { reason: "Selected target is not available in this workspace.", target: null };
    if (lead.status === "CONVERTED") {
      return { reason: "Converted leads are locked. Add new context on the converted deal.", target: null };
    }
    return { target: { id: lead.id, label: lead.title, type: "lead" as const } };
  }

  if (target.type === "person") {
    const person = await prisma.person.findFirst({
      where: { id: target.id, workspaceId: actor.workspaceId, deletedAt: null },
      select: { email: true, firstName: true, id: true, lastName: true }
    });
    if (!person) return { reason: "Selected target is not available in this workspace.", target: null };
    return { target: { id: person.id, label: formatPersonName(person) ?? person.email ?? "Unnamed contact", type: "person" as const } };
  }

  const organization = await prisma.organization.findFirst({
    where: { id: target.id, workspaceId: actor.workspaceId, deletedAt: null },
    select: { id: true, name: true }
  });
  if (!organization) return { reason: "Selected target is not available in this workspace.", target: null };
  return { target: { id: organization.id, label: organization.name, type: "organization" as const } };
}

export function formatMeetingIntakeFailureMessage(error: unknown, fallback = "Meeting intake processing failed.") {
  if (error instanceof ApiError || error instanceof Error) {
    return redactSensitiveText(error.message) || fallback;
  }
  if (typeof error === "string") {
    return redactSensitiveText(error) || fallback;
  }
  return fallback;
}

type MeetingIntakeProcessorStatus = {
  capability: ProcessorCapability;
  conversionMode: MeetingSourceConversionMode;
  extractionMethod: string;
  failureCode?: string;
  message?: string;
  originalFilename?: string;
  originalMimeType?: string;
  processor?: string;
  providerId?: string;
  providerName?: string;
  requiredProvider?: MeetingSourceProviderRequirement;
  sourceType: MeetingSourceType;
  warnings?: string[];
};

function buildProcessorStatus(
  detection: SourceDetectionResult,
  input: ReturnType<typeof normalizeCreateMeetingIntakeInput>,
  result: { error?: unknown; extracted?: ExtractedMeetingText; message?: string } = {}
): MeetingIntakeProcessorStatus {
  const extracted = result.extracted;
  const scannedPdfNeedsProvider =
    result.error instanceof ApiError && result.error.code === "MEETING_INTAKE_OCR_REQUIRED" && detection.sourceType === "pdf";
  const capability: ProcessorCapability = scannedPdfNeedsProvider ? "provider_required" : detection.capability;
  const conversionMode: MeetingSourceConversionMode = scannedPdfNeedsProvider ? "provider_required" : detection.conversionMode;
  const status: MeetingIntakeProcessorStatus = {
    capability,
    conversionMode,
    extractionMethod: scannedPdfNeedsProvider ? "provider-required" : extracted?.metadata.extractionMethod ?? detection.extractionMethod,
    sourceType: detection.sourceType
  };

  const message = result.message ?? extracted?.metadata.statusMessage ?? detection.message;
  const requiredProvider = scannedPdfNeedsProvider ? "ocr_or_vision" : detection.requiredProvider;
  const warnings = extracted?.warnings ?? extracted?.metadata.warnings;

  if (input.originalFilename) status.originalFilename = input.originalFilename;
  if (input.originalMimeType) status.originalMimeType = input.originalMimeType;
  if (extracted?.metadata.processor) status.processor = extracted.metadata.processor;
  if (extracted?.metadata.providerId) status.providerId = extracted.metadata.providerId;
  if (extracted?.metadata.providerName) status.providerName = extracted.metadata.providerName;
  if (result.error instanceof ApiError) status.failureCode = result.error.code;
  if (message) status.message = message;
  if (requiredProvider) status.requiredProvider = requiredProvider;
  if (warnings?.length) status.warnings = warnings;
  return status;
}

function normalizeCreateMeetingIntakeInput(data: CreateMeetingIntakeInput) {
  const input = objectInput(data);
  return {
    contextText: normalizeOptionalText(input.contextText, 20_000),
    explicitSourceType: normalizeSourceType(input.explicitSourceType),
    fileBase64: normalizeOptionalBase64(input.fileBase64, 12_000_000),
    fileText: normalizeOptionalText(input.fileText, 120_000),
    hints: normalizeHints(input.hints),
    originalFilename: normalizeOptionalText(input.originalFilename, 255),
    originalMimeType: normalizeOptionalText(input.originalMimeType, 255),
    text: normalizeOptionalText(input.text, 120_000)
  };
}

function parseMeetingMediaExtractionJobPayload(payload: unknown): MeetingMediaExtractionJobPayload {
  const input = objectInput(payload);
  const actorUserId = normalizeOptionalText(input.actorUserId, 120);
  const fileBase64 = normalizeOptionalBase64(input.fileBase64, 12_000_000);
  const intakeId = normalizeOptionalText(input.intakeId, 120);
  const sourceType = input.sourceType;
  const workspaceId = normalizeOptionalText(input.workspaceId, 120);

  if (
    !actorUserId ||
    !fileBase64 ||
    !intakeId ||
    !(sourceType === "audio" || sourceType === "image" || sourceType === "video") ||
    !workspaceId
  ) {
    throw new Error("Invalid meeting media extraction job payload.");
  }

  return {
    actorUserId,
    contextText: normalizeOptionalText(input.contextText, 20_000),
    fileBase64,
    hints: normalizeHints(input.hints),
    intakeId,
    originalFilename: normalizeOptionalText(input.originalFilename, 255),
    originalMimeType: normalizeOptionalText(input.originalMimeType, 255),
    sourceType,
    workspaceId
  };
}

function assertMeetingIntakeHasSource(input: ReturnType<typeof normalizeCreateMeetingIntakeInput>) {
  if (input.text || input.fileText || input.fileBase64 || input.originalFilename || input.originalMimeType) return;
  throw new ApiError("VALIDATION_ERROR", "Paste meeting notes or upload a meeting artifact before creating an intake.", 422);
}

function normalizeApplyInput(data: unknown, draft: MeetingIntelligenceDraft): ApplyMeetingIntelligenceInput {
  const input = objectInput(data);
  return {
    meetingActivity: normalizeMeetingActivity(input.meetingActivity, draft.meetingActivity),
    notes: normalizeNotes(input.notes, draft.notes),
    nextStepActivities: normalizeNextActivities(input.nextStepActivities, draft.nextStepActivities)
  };
}

function normalizeMeetingActivity(value: unknown, fallback: MeetingIntelligenceDraft["meetingActivity"]) {
  if (!fallback) return null;
  const input = objectInput(value);
  return {
    ...fallback,
    associatedTargets: normalizeAssociatedTargets(input.associatedTargets, fallback.associatedTargets, fallback.target),
    completedAt: normalizeOptionalText(input.completedAt, 80) ?? fallback.completedAt,
    description: normalizeRequiredText(input.description, "Meeting activity description is required.", 40_000) ?? fallback.description,
    include: normalizeBoolean(input.include, fallback.include),
    target: normalizeTarget(input.target, fallback.target),
    title: normalizeRequiredText(input.title, "Meeting activity title is required.", 180) ?? fallback.title
  };
}

function normalizeAssociatedTargets(value: unknown, fallback: CrmTarget[] | undefined, primaryTarget: CrmTarget | null) {
  if (value === undefined) return uniqueTargets([primaryTarget, ...(fallback ?? [])]);
  if (!Array.isArray(value)) return uniqueTargets([primaryTarget]);
  return uniqueTargets([
    primaryTarget,
    ...value.flatMap((item) => {
      const input = objectInput(item);
      if (input.include === false) return [];
      return normalizeTarget(input.target, null) ?? normalizeTarget(input, null) ?? [];
    })
  ]);
}

function normalizeNotes(value: unknown, fallback: MeetingIntelligenceDraft["notes"]) {
  const values = Array.isArray(value) ? value : [];
  return fallback.map((note, index) => {
    const input = objectInput(values[index]);
    return {
      ...note,
      body: normalizeRequiredText(input.body, "Note body is required.", 40_000) ?? note.body,
      include: normalizeBoolean(input.include, note.include),
      target: normalizeTarget(input.target, note.target)
    };
  });
}

function normalizeNextActivities(value: unknown, fallback: MeetingIntelligenceDraft["nextStepActivities"]) {
  const values = Array.isArray(value) ? value : [];
  return fallback.map((activity, index) => {
    const input = objectInput(values[index]);
    return {
      ...activity,
      description: normalizeOptionalText(input.description, 20_000) ?? activity.description,
      dueAt: normalizeOptionalText(input.dueAt, 80) ?? activity.dueAt,
      include: normalizeBoolean(input.include, activity.include),
      ownerId: normalizeOptionalText(input.ownerId, 120) ?? activity.ownerId,
      target: normalizeTarget(input.target, activity.target),
      title: normalizeRequiredText(input.title, "Activity title is required.", 180) ?? activity.title,
      type: normalizeActivityType(input.type, activity.type)
    };
  });
}

function normalizeTarget(value: unknown, fallback: CrmTarget | null): CrmTarget | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const input = objectInput(value);
  const type = input.type === "deal" || input.type === "lead" || input.type === "person" || input.type === "organization" ? input.type : undefined;
  const id = normalizeOptionalText(input.id, 120);
  if (!type || !id) return null;
  return { id, label: normalizeOptionalText(input.label, 255), type };
}

function normalizeHints(value: unknown): MatchRecordHints {
  const input = objectInput(value);
  return {
    dealId: normalizeOptionalText(input.dealId, 120),
    leadId: normalizeOptionalText(input.leadId, 120),
    organizationId: normalizeOptionalText(input.organizationId, 120),
    personIds: Array.isArray(input.personIds)
      ? input.personIds.map((item) => normalizeOptionalText(item, 120)).filter((item): item is string => Boolean(item))
      : []
  };
}

function parseDraft(value: Prisma.JsonValue): MeetingIntelligenceDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("MEETING_INTAKE_DRAFT_INVALID", "Meeting intake draft is invalid.", 409);
  }
  return value as unknown as MeetingIntelligenceDraft;
}

function toPrismaSourceType(sourceType: MeetingSourceType) {
  const map: Record<MeetingSourceType, MeetingIntakeSourceType> = {
    audio: MeetingIntakeSourceType.AUDIO,
    csv: MeetingIntakeSourceType.TEXT_FILE,
    docx: MeetingIntakeSourceType.DOCX,
    html: MeetingIntakeSourceType.TEXT_FILE,
    image: MeetingIntakeSourceType.IMAGE,
    json: MeetingIntakeSourceType.TEXT_FILE,
    markdown: MeetingIntakeSourceType.MARKDOWN,
    pasted_text: MeetingIntakeSourceType.PASTED_TEXT,
    pdf: MeetingIntakeSourceType.PDF,
    pptx: MeetingIntakeSourceType.UNSUPPORTED,
    rtf: MeetingIntakeSourceType.TEXT_FILE,
    text_file: MeetingIntakeSourceType.TEXT_FILE,
    unsupported: MeetingIntakeSourceType.UNSUPPORTED,
    video: MeetingIntakeSourceType.VIDEO,
    xlsx: MeetingIntakeSourceType.UNSUPPORTED
  };
  return map[sourceType];
}

function targetAttachment(target: CrmTarget) {
  if (target.type === "deal") return { dealId: target.id };
  if (target.type === "lead") return { leadId: target.id };
  if (target.type === "person") return { personId: target.id };
  return { organizationId: target.id };
}

function targetAssociation(target: CrmTarget) {
  if (target.type === "deal") return { dealId: target.id };
  if (target.type === "lead") return { leadId: target.id };
  if (target.type === "person") return { personId: target.id };
  return { organizationId: target.id };
}

function uniqueTargets(targets: Array<CrmTarget | null | undefined>) {
  const seen = new Set<string>();
  const result: CrmTarget[] = [];
  for (const target of targets) {
    if (!target) continue;
    const key = `${target.type}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function targetHref(target: CrmTarget) {
  if (target.type === "deal") return `/deals/${target.id}`;
  if (target.type === "lead") return `/leads/${target.id}`;
  if (target.type === "person") return `/contacts/${target.id}`;
  return `/organizations/${target.id}`;
}

function targetLabel(target: CrmTarget | null | undefined, fallback: string) {
  if (!target) return fallback;
  return target.label ? `${target.label} ${fallback}` : fallback;
}

function normalizeActivityType(value: unknown, fallback: "CALL" | "EMAIL" | "MEETING" | "TASK") {
  return value === "CALL" || value === "EMAIL" || value === "MEETING" || value === "TASK" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeRequiredText(value: unknown, message: string, maxLength: number) {
  const text = normalizeOptionalText(value, maxLength);
  if (!text && value !== undefined) throw new ApiError("VALIDATION_ERROR", message, 422);
  return text;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeOptionalBase64(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new ApiError("VALIDATION_ERROR", "Uploaded file payload is invalid.", 422);
  }
  if (trimmed.length > maxLength) {
    throw new ApiError("VALIDATION_ERROR", "Uploaded file payload is too large for Meeting Intelligence.", 422);
  }
  return trimmed;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function formatPersonName(person: { firstName: string | null; lastName: string | null }) {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || undefined;
}
