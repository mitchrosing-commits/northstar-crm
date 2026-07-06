import { JobStatus, MeetingIntakeSourceType, MeetingIntakeStatus, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { extractMeetingText, meetingIntelligenceLocalBinaryMaxBytes } from "@/lib/meeting-intelligence/extractors";
import {
  abortMeetingIntelligenceMultipartUpload,
  cleanupExpiredStoredMeetingIntelligenceFiles,
  completeMeetingIntelligenceMultipartUpload,
  createMeetingIntelligenceDirectUploadTarget,
  createMeetingIntelligenceMultipartUploadPartTargets,
  createMeetingIntelligenceMultipartUploadTarget,
  defaultMeetingIntelligenceMultipartUploadMaxParts,
  defaultMeetingIntelligenceMultipartUploadPartSizeBytes,
  defaultMeetingIntelligenceSingleObjectDirectUploadMaxBytes,
  deleteStoredMeetingIntelligenceFile,
  finalizeMeetingIntelligenceDirectUpload,
  getMeetingIntelligenceFileStorageConfig,
  inspectMeetingIntelligenceMultipartUpload,
  normalizeStoredMeetingIntelligenceFileRef,
  readStoredMeetingIntelligenceFile,
  storeMeetingIntelligenceFile,
  type StoredMeetingIntelligenceFileRef
} from "@/lib/meeting-intelligence/file-storage";
import { meetingDirectUploadMinBytes } from "@/lib/meeting-intelligence/direct-upload-eligibility";
import { normalizeMeetingMarkdown } from "@/lib/meeting-intelligence/markdown-normalizer";
import { unsupportedScannedPdfError, unsupportedVideoError } from "@/lib/meeting-intelligence/openai-media-provider";
import {
  createConfiguredMeetingMediaProvider,
  getMeetingMediaProviderReadiness,
  isMediaProviderSourceType,
  mediaProviderRequiredMessage,
  meetingMediaExtractionJobType,
  type MediaExtractionKind,
  type MediaExtractionProvider
} from "@/lib/meeting-intelligence/media-providers";
import { matchMeetingCrmObjects, type MatchRecordHints } from "@/lib/meeting-intelligence/match-records";
import { deterministicMeetingAnalysisProvider } from "@/lib/meeting-intelligence/providers";
import {
  createOpenAISemanticRelationshipBriefProvider,
  relationshipSemanticExtractionReadiness,
  type SemanticRelationshipBriefProvider,
  type SemanticRelationshipBriefProviderInput
} from "@/lib/meeting-intelligence/relationship-semantic-provider";
import { detectMeetingSource, normalizeSourceType } from "@/lib/meeting-intelligence/source-detection";
import type {
  ApplyMeetingIntelligenceInput,
  ApplyMeetingIntelligenceResult,
  CrmTarget,
  ExtractedMeetingText,
  MatchedCrmObject,
  MeetingIntelligenceDraft,
  MeetingSourceConversionMode,
  MeetingSourceProviderRequirement,
  ProcessorCapability,
  ProposedRelationshipBriefFact,
  ProposedRelationshipBriefUpdate,
  RelationshipBriefChangeSummary,
  RelationshipBriefFields,
  RelationshipBriefSensitivityGuidance,
  SourceDetectionResult,
  MeetingSourceType
} from "@/lib/meeting-intelligence/types";
import { redactSensitiveText } from "@/lib/security/redaction";

import { createActivity } from "./activity-service";
import { createNote } from "./note-service";
import { enqueueJob } from "./job-service";
import { updatePerson } from "./contact-service";
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

type CreateMeetingIntakeDirectUploadSessionInput = {
  byteLength?: unknown;
  explicitSourceType?: unknown;
  originalFilename?: unknown;
  originalMimeType?: unknown;
  sha256?: unknown;
};

type FinalizeMeetingIntakeDirectUploadSessionInput = CreateMeetingIntakeInput & {
  byteLength?: unknown;
  sha256?: unknown;
};

type CreateMeetingIntakeMultipartUploadSessionInput = CreateMeetingIntakeDirectUploadSessionInput & {
  partSizeBytes?: unknown;
};

type SignMeetingIntakeMultipartUploadPartsInput = {
  partNumbers?: unknown;
};

type CompleteMeetingIntakeMultipartUploadSessionInput = FinalizeMeetingIntakeDirectUploadSessionInput & {
  parts?: unknown;
};

const maxMeetingIntakeFileBase64Length = 72_000_000;
export const maxMeetingIntakeFileBase64EncodedLength = maxMeetingIntakeFileBase64Length;

type NormalizedCreateMeetingIntakeInput = ReturnType<typeof normalizeCreateMeetingIntakeInput>;

type MeetingIntelligenceProcessingOptions = {
  relationshipBriefProvider?: SemanticRelationshipBriefProvider | null;
};

export type MeetingMediaExtractionJobPayload = {
  actorUserId: string;
  contextText?: string;
  fileBase64?: string;
  hints?: MatchRecordHints;
  intakeId: string;
  originalFilename?: string;
  originalMimeType?: string;
  sourceType: MediaExtractionKind;
  storedFile?: StoredMeetingIntelligenceFileRef;
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

export async function getMeetingIntakeUploadCapabilities(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  const storageConfig = getMeetingIntelligenceFileStorageConfig();
  const providerReadiness = getMeetingMediaProviderReadiness();
  const storageSupportsDirectUpload = storageConfig.backend === "s3-compatible";
  const directUploadAvailable = storageSupportsDirectUpload && providerReadiness.configured;
  const multipartUploadAvailable = directUploadAvailable;
  const maxBase64DecodedBytes = Math.floor(maxMeetingIntakeFileBase64EncodedLength * 3 / 4);
  const providerFallbackMaxBytes = Math.min(maxBase64DecodedBytes, storageConfig.maxBytes);
  const localExtractionSourceTypes = ["pasted_text", "markdown", "text_file", "rtf", "html", "csv", "json", "pdf", "docx"] as const;
  const providerExtractionSourceTypes = ["image", "audio", "video", "pdf"] as const;
  const unsupportedSourceTypes = [
    {
      reason: "PPTX deck extraction is not implemented yet. Export to PDF, DOCX, markdown, HTML, or text before intake.",
      sourceType: "pptx" as const
    },
    {
      reason: "XLSX workbook extraction is not implemented yet. Export to CSV, markdown, HTML, or text before intake.",
      sourceType: "xlsx" as const
    },
    {
      reason: "Legacy .doc and unknown binary files are not supported. Convert legacy Word documents to .docx before intake.",
      sourceType: "unsupported" as const
    }
  ];
  const directUploadSourceTypes = directUploadAvailable ? providerReadiness.supportedSourceTypes : [];
  const providerSupport = Object.fromEntries(
    providerExtractionSourceTypes.map((sourceType) => {
      const supported = providerReadiness.supportedSourceTypes.includes(sourceType);
      return [sourceType, {
        available: providerReadiness.configured && supported,
        directUpload: directUploadAvailable && supported,
        reason: providerReadiness.configured && !supported
          ? `${sourceType.toUpperCase()} extraction is not supported by the configured provider.`
          : !providerReadiness.configured
            ? mediaProviderRequiredMessage(sourceType)
            : undefined
      }];
    })
  ) as Record<(typeof providerExtractionSourceTypes)[number], { available: boolean; directUpload: boolean; reason?: string }>;

  return {
    base64Request: {
      available: true,
      maxDecodedBytes: maxBase64DecodedBytes,
      maxEncodedCharacters: maxMeetingIntakeFileBase64EncodedLength,
      providerFallbackMaxBytes
    },
    directUpload: {
      available: directUploadAvailable,
      maxBytes: Math.min(storageConfig.maxBytes, defaultMeetingIntelligenceSingleObjectDirectUploadMaxBytes),
      minBytes: meetingDirectUploadMinBytes,
      reason: directUploadAvailable
        ? undefined
        : storageSupportsDirectUpload
          ? "Direct upload requires a configured Meeting Intelligence media provider."
          : "Direct upload requires S3/R2-compatible Meeting Intelligence file storage.",
      sourceTypes: directUploadSourceTypes
    },
    guidance: {
      fallback:
        "Small local documents and dev/local storage uploads use the bounded app upload path; large provider files should use direct upload when available.",
      summary: directUploadAvailable
        ? "Large provider-backed image, scanned PDF, audio, or video files can upload directly to private object storage when the provider supports that source type."
        : "Direct upload is not available in this environment; supported local files still process normally, and provider-backed files require both provider and storage support.",
      tooLarge: `Provider-backed Meeting Intelligence files are limited to ${formatMegabytes(storageConfig.maxBytes)} MB.`,
      unsupported: "Unsupported files are blocked before upload. Export PPTX/XLSX or legacy documents to a supported format first."
    },
    localExtraction: {
      maxBinaryBytes: meetingIntelligenceLocalBinaryMaxBytes,
      maxTextCharacters: 120_000,
      sourceTypes: [...localExtractionSourceTypes]
    },
    multipartUpload: {
      abortSupported: multipartUploadAvailable,
      cleanup: "Expired multipart metadata is eligible for conservative stored-file cleanup; active extraction files are skipped.",
      maxBytes: storageConfig.maxBytes,
      maxParts: defaultMeetingIntelligenceMultipartUploadMaxParts,
      minBytes: Math.min(storageConfig.maxBytes, defaultMeetingIntelligenceSingleObjectDirectUploadMaxBytes) + 1,
      partSizeBytes: defaultMeetingIntelligenceMultipartUploadPartSizeBytes,
      reason: multipartUploadAvailable
        ? undefined
        : storageSupportsDirectUpload
          ? "Multipart upload requires a configured Meeting Intelligence media provider."
          : "Multipart upload requires S3/R2-compatible Meeting Intelligence file storage.",
      sourceTypes: multipartUploadAvailable ? providerReadiness.supportedSourceTypes : [],
      supported: multipartUploadAvailable
    },
    providerExtraction: {
      configured: providerReadiness.configured,
      sourceTypes: [...providerExtractionSourceTypes],
      support: providerSupport,
      supportedSourceTypes: providerReadiness.supportedSourceTypes
    },
    storage: {
      backendCategory: storageConfig.backend,
      directUploadSupported: storageSupportsDirectUpload,
      private: true,
      retentionDays: storageConfig.retentionDays
    },
    unsupportedSourceTypes
  };
}

export async function createMeetingIntake(
  actor: WorkspaceActor,
  data: CreateMeetingIntakeInput,
  options: MeetingIntelligenceProcessingOptions = {}
) {
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
    return queueOrFailProviderMeetingIntake(
      actor,
      intake.id,
      input,
      detection as SourceDetectionResult & { sourceType: "audio" | "image" | "video" },
      detection.sourceType
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
    const updated = await finishMeetingIntakeExtraction(actor, intake.id, input, detection, extracted, options);
    await writeAuditLog(actor, "meeting_intake.created", "MeetingIntake", intake.id, {
      sourceType: detection.sourceType,
      status: updated.status
    });
    return updated;
  } catch (error) {
    if (isScannedPdfOcrRequired(error, detection)) {
      return queueOrFailProviderMeetingIntake(actor, intake.id, input, scannedPdfProviderDetection(detection), "pdf");
    }
    const failed = await failMeetingIntake(intake.id, input, detection, error);
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intake.id, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }
}

export async function createMeetingIntakeDirectUploadSession(
  actor: WorkspaceActor,
  data: CreateMeetingIntakeDirectUploadSessionInput
) {
  await ensureWorkspaceAccess(actor);
  const input = normalizeCreateDirectUploadSessionInput(data);
  const detection = detectMeetingSource({
    explicitSourceType: input.explicitSourceType,
    filename: input.originalFilename,
    mimeType: input.originalMimeType
  });
  const providerSourceType = directUploadProviderSourceType(detection.sourceType);
  const providerReadiness = getMeetingMediaProviderReadiness();
  if (!providerReadiness.configured) {
    throw new ApiError("MEETING_INTAKE_PROVIDER_NOT_CONFIGURED", mediaProviderRequiredMessage(providerSourceType), 422);
  }
  if (!providerReadiness.supportedSourceTypes.includes(providerSourceType)) {
    throw providerSourceType === "video"
      ? unsupportedVideoError()
      : providerSourceType === "pdf"
        ? unsupportedScannedPdfError()
        : new ApiError("MEETING_INTAKE_PROVIDER_UNAVAILABLE", mediaProviderRequiredMessage(providerSourceType), 422);
  }

  const storageConfig = getMeetingIntelligenceFileStorageConfig();
  const intake = await prisma.meetingIntake.create({
    data: {
      workspaceId: actor.workspaceId,
      createdById: actor.actorUserId,
      sourceType: toPrismaSourceType(detection.sourceType),
      originalFilename: input.originalFilename,
      originalMimeType: input.originalMimeType,
      status: MeetingIntakeStatus.DRAFT
    }
  });

  try {
    const target = await createMeetingIntelligenceDirectUploadTarget({
      byteLength: input.byteLength,
      filename: input.originalFilename,
      intakeId: intake.id,
      mimeType: input.originalMimeType,
      sha256: input.sha256,
      sourceType: providerSourceType,
      workspaceId: actor.workspaceId
    });
    const processorDetection = providerSourceType === "pdf" ? scannedPdfProviderDetection(detection) : detection;
    const sessionInput = {
      contextText: undefined,
      explicitSourceType: providerSourceType,
      fileBase64: undefined,
      fileText: undefined,
      hints: {},
      originalFilename: input.originalFilename,
      originalMimeType: input.originalMimeType,
      directUploadSession: undefined,
      storedFile: target.storedFile,
      text: undefined
    } satisfies NormalizedCreateMeetingIntakeInput;
    await prisma.meetingIntake.update({
      where: { id: intake.id },
      data: {
        analysisJson: toJson({
          detection: processorDetection,
          directUploadSession: {
            status: "awaiting_upload",
            storedFile: target.storedFile,
            uploadExpiresAt: target.upload.expiresAt
          },
          processorStatus: buildProcessorStatus(processorDetection, sessionInput, {
            message: "Waiting for direct upload completion."
          }),
          providerReadiness,
          storedFile: storedFileForAnalysis(target.storedFile)
        })
      }
    });
    return {
      acceptedSourceType: providerSourceType,
      intakeId: intake.id,
      maxBytes: storageConfig.maxBytes,
      provider: {
        configured: providerReadiness.configured,
        providerId: providerReadiness.providerId,
        providerName: providerReadiness.providerName,
        supportedSourceTypes: providerReadiness.supportedSourceTypes
      },
      upload: target.upload,
      uploadSessionId: intake.id
    };
  } catch (error) {
    await prisma.meetingIntake.delete({ where: { id: intake.id } }).catch(() => undefined);
    throw error;
  }
}

export async function finalizeMeetingIntakeDirectUploadSession(
  actor: WorkspaceActor,
  uploadSessionId: string,
  data: FinalizeMeetingIntakeDirectUploadSessionInput,
  options: MeetingIntelligenceProcessingOptions = {}
) {
  await ensureWorkspaceAccess(actor);
  const input = normalizeFinalizeDirectUploadSessionInput(data);
  const intake = await prisma.meetingIntake.findFirst({
    where: { id: uploadSessionId, workspaceId: actor.workspaceId },
    select: {
      analysisJson: true,
      contextText: true,
      id: true,
      originalFilename: true,
      originalMimeType: true,
      status: true,
      workspaceId: true
    }
  });
  if (!intake) throw new ApiError("NOT_FOUND", "Meeting direct upload session was not found.", 404);
  if (intake.status !== MeetingIntakeStatus.DRAFT) {
    throw new ApiError(
      "MEETING_INTAKE_DIRECT_UPLOAD_INVALID_STATE",
      "Meeting direct upload session is already finalized or is not waiting for upload completion.",
      409
    );
  }

  const storedFile = storedFileFromDirectUploadSession(intake.analysisJson);
  if (!storedFile || storedFile.workspaceId !== actor.workspaceId || storedFile.intakeId !== intake.id) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  if (storedFile.byteLength !== input.byteLength) {
    throw new ApiError(
      "MEETING_INTAKE_STORED_FILE_SIZE_MISMATCH",
      "Uploaded meeting file size did not match the upload session. Upload the meeting artifact again.",
      422
    );
  }
  if (storedFile.sha256 !== input.sha256) {
    throw new ApiError(
      "MEETING_INTAKE_STORED_FILE_CHECKSUM_MISMATCH",
      "Uploaded meeting file checksum did not match the upload session. Upload the meeting artifact again.",
      422
    );
  }
  if (input.explicitSourceType && input.explicitSourceType !== storedFile.sourceType) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file source type does not match the upload session.", 422);
  }
  if (input.originalFilename && intake.originalFilename && input.originalFilename !== intake.originalFilename) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file metadata does not match the upload session.", 422);
  }
  if (input.originalMimeType && intake.originalMimeType && input.originalMimeType !== intake.originalMimeType) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file metadata does not match the upload session.", 422);
  }

  const finalized = await finalizeMeetingIntelligenceDirectUpload(storedFile);
  const detection = detectMeetingSource({
    explicitSourceType: finalized.sourceType,
    filename: input.originalFilename ?? intake.originalFilename ?? finalized.filename,
    mimeType: input.originalMimeType ?? intake.originalMimeType ?? finalized.mimeType
  });
  const processorDetection = finalized.sourceType === "pdf" ? scannedPdfProviderDetection(detection) : detection;
  await prisma.meetingIntake.update({
    where: { id: intake.id },
    data: {
      contextText: input.contextText,
      originalFilename: input.originalFilename ?? intake.originalFilename,
      originalMimeType: input.originalMimeType ?? intake.originalMimeType
    }
  });

  const queuedInput: NormalizedCreateMeetingIntakeInput = {
    contextText: input.contextText,
    explicitSourceType: finalized.sourceType,
    fileBase64: undefined,
    fileText: undefined,
    hints: input.hints,
    originalFilename: input.originalFilename ?? intake.originalFilename ?? finalized.filename,
    originalMimeType: input.originalMimeType ?? intake.originalMimeType ?? finalized.mimeType,
    directUploadSession: { status: "queued" as const },
    storedFile: finalized,
    text: undefined
  };
  return queueOrFailProviderMeetingIntakeWithStoredFile(
    actor,
    intake.id,
    queuedInput,
    processorDetection,
    finalized.sourceType,
    finalized,
    options
  );
}

export async function createMeetingIntakeMultipartUploadSession(
  actor: WorkspaceActor,
  data: CreateMeetingIntakeMultipartUploadSessionInput
) {
  await ensureWorkspaceAccess(actor);
  const input = normalizeCreateMultipartUploadSessionInput(data);
  const detection = detectMeetingSource({
    explicitSourceType: input.explicitSourceType,
    filename: input.originalFilename,
    mimeType: input.originalMimeType
  });
  const providerSourceType = directUploadProviderSourceType(detection.sourceType);
  assertMultipartProviderReady(providerSourceType);

  const intake = await prisma.meetingIntake.create({
    data: {
      workspaceId: actor.workspaceId,
      createdById: actor.actorUserId,
      sourceType: toPrismaSourceType(detection.sourceType),
      originalFilename: input.originalFilename,
      originalMimeType: input.originalMimeType,
      status: MeetingIntakeStatus.DRAFT
    }
  });

  try {
    const target = await createMeetingIntelligenceMultipartUploadTarget({
      byteLength: input.byteLength,
      filename: input.originalFilename,
      intakeId: intake.id,
      mimeType: input.originalMimeType,
      partSizeBytes: input.partSizeBytes,
      sha256: input.sha256,
      sourceType: providerSourceType,
      workspaceId: actor.workspaceId
    });
    const providerReadiness = getMeetingMediaProviderReadiness();
    const processorDetection = providerSourceType === "pdf" ? scannedPdfProviderDetection(detection) : detection;
    const sessionInput = {
      contextText: undefined,
      explicitSourceType: providerSourceType,
      fileBase64: undefined,
      fileText: undefined,
      hints: {},
      originalFilename: input.originalFilename,
      originalMimeType: input.originalMimeType,
      directUploadSession: undefined,
      storedFile: target.storedFile,
      text: undefined
    } satisfies NormalizedCreateMeetingIntakeInput;
    await prisma.meetingIntake.update({
      where: { id: intake.id },
      data: {
        analysisJson: toJson({
          detection: processorDetection,
          multipartUploadSession: {
            partCount: target.multipart.partCount,
            partSizeBytes: target.multipart.partSizeBytes,
            status: "awaiting_parts",
            storedFile: target.storedFile,
            uploadExpiresAt: target.multipart.expiresAt
          },
          processorStatus: buildProcessorStatus(processorDetection, sessionInput, {
            message: "Waiting for multipart upload completion."
          }),
          providerReadiness,
          storedFile: storedFileForAnalysis(target.storedFile)
        })
      }
    });
    return {
      acceptedSourceType: providerSourceType,
      intakeId: intake.id,
      multipart: target.multipart,
      uploadSessionId: intake.id
    };
  } catch (error) {
    await prisma.meetingIntake.delete({ where: { id: intake.id } }).catch(() => undefined);
    throw error;
  }
}

export async function signMeetingIntakeMultipartUploadParts(
  actor: WorkspaceActor,
  uploadSessionId: string,
  data: SignMeetingIntakeMultipartUploadPartsInput
) {
  await ensureWorkspaceAccess(actor);
  const input = normalizeSignMultipartUploadPartsInput(data);
  const intake = await findDraftMultipartUploadIntake(actor, uploadSessionId);
  const storedFile = storedFileFromDirectUploadSession(intake.analysisJson);
  if (!storedFile || storedFile.workspaceId !== actor.workspaceId || storedFile.intakeId !== intake.id) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  const parts = await createMeetingIntelligenceMultipartUploadPartTargets(storedFile, { partNumbers: input.partNumbers });
  return { parts, uploadSessionId: intake.id };
}

export async function inspectMeetingIntakeMultipartUploadSession(actor: WorkspaceActor, uploadSessionId: string) {
  await ensureWorkspaceAccess(actor);
  const intake = await prisma.meetingIntake.findFirst({
    where: { id: uploadSessionId, workspaceId: actor.workspaceId },
    select: {
      analysisJson: true,
      id: true,
      originalFilename: true,
      originalMimeType: true,
      status: true
    }
  });
  if (!intake) throw new ApiError("NOT_FOUND", "Meeting multipart upload session was not found.", 404);

  if (intake.status !== MeetingIntakeStatus.DRAFT) {
    if (
      intake.status === MeetingIntakeStatus.EXTRACTING ||
      intake.status === MeetingIntakeStatus.EXTRACTED ||
      intake.status === MeetingIntakeStatus.ANALYZING ||
      intake.status === MeetingIntakeStatus.READY_FOR_REVIEW ||
      intake.status === MeetingIntakeStatus.APPLIED
    ) {
      return {
        abortAllowed: false,
        intakeId: intake.id,
        resumeAllowed: false,
        status: "queued" as const,
        uploadSessionId: intake.id
      };
    }
    throw new ApiError(
      "MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE",
      "Meeting multipart upload session is already finalized, aborted, or is not waiting for upload completion.",
      409
    );
  }

  const storedFile = storedFileFromDirectUploadSession(intake.analysisJson);
  if (!storedFile || storedFile.workspaceId !== actor.workspaceId || storedFile.intakeId !== intake.id) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  const status = await inspectMeetingIntelligenceMultipartUpload(storedFile);
  return {
    abortAllowed: true,
    acceptedSourceType: storedFile.sourceType,
    byteLength: storedFile.byteLength,
    intakeId: intake.id,
    multipart: {
      expiresAt: status.expiresAt,
      maxParts: status.maxParts,
      partCount: status.partCount,
      partSizeBytes: status.partSizeBytes,
      uploadedPartCount: status.parts.length,
      uploadedParts: status.parts
    },
    originalMimeType: intake.originalMimeType ?? storedFile.mimeType,
    resumeAllowed: true,
    sha256: storedFile.sha256,
    status: "awaiting_parts" as const,
    uploadSessionId: intake.id
  };
}

export async function completeMeetingIntakeMultipartUploadSession(
  actor: WorkspaceActor,
  uploadSessionId: string,
  data: CompleteMeetingIntakeMultipartUploadSessionInput,
  options: MeetingIntelligenceProcessingOptions = {}
) {
  await ensureWorkspaceAccess(actor);
  const input = normalizeCompleteMultipartUploadSessionInput(data);
  const intake = await findDraftMultipartUploadIntake(actor, uploadSessionId);
  const storedFile = storedFileFromDirectUploadSession(intake.analysisJson);
  if (!storedFile || storedFile.workspaceId !== actor.workspaceId || storedFile.intakeId !== intake.id) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  validateStoredFileCompletionInput(storedFile, intake, input);

  const finalized = await completeMeetingIntelligenceMultipartUpload(storedFile, { parts: input.parts });
  const detection = detectMeetingSource({
    explicitSourceType: finalized.sourceType,
    filename: input.originalFilename ?? intake.originalFilename ?? finalized.filename,
    mimeType: input.originalMimeType ?? intake.originalMimeType ?? finalized.mimeType
  });
  const processorDetection = finalized.sourceType === "pdf" ? scannedPdfProviderDetection(detection) : detection;
  await prisma.meetingIntake.update({
    where: { id: intake.id },
    data: {
      contextText: input.contextText,
      originalFilename: input.originalFilename ?? intake.originalFilename,
      originalMimeType: input.originalMimeType ?? intake.originalMimeType
    }
  });
  const queuedInput: NormalizedCreateMeetingIntakeInput = {
    contextText: input.contextText,
    explicitSourceType: finalized.sourceType,
    fileBase64: undefined,
    fileText: undefined,
    hints: input.hints,
    originalFilename: input.originalFilename ?? intake.originalFilename ?? finalized.filename,
    originalMimeType: input.originalMimeType ?? intake.originalMimeType ?? finalized.mimeType,
    directUploadSession: { mode: "multipart" as const, status: "queued" as const },
    storedFile: finalized,
    text: undefined
  };
  return queueOrFailProviderMeetingIntakeWithStoredFile(
    actor,
    intake.id,
    queuedInput,
    processorDetection,
    finalized.sourceType,
    finalized,
    options
  );
}

export async function abortMeetingIntakeMultipartUploadSession(actor: WorkspaceActor, uploadSessionId: string) {
  await ensureWorkspaceAccess(actor);
  const intake = await findDraftMultipartUploadIntake(actor, uploadSessionId);
  const storedFile = storedFileFromDirectUploadSession(intake.analysisJson);
  if (storedFile) await abortMeetingIntelligenceMultipartUpload(storedFile).catch(() => undefined);
  return prisma.meetingIntake.update({
    where: { id: intake.id },
    data: {
      analysisJson: toJson({
        multipartUploadSession: { status: "aborted" },
        processorStatus: {
          capability: "provider_required",
          message: "Multipart upload was aborted.",
          status: "failed"
        }
      }),
      errorMessage: "Multipart upload was aborted.",
      status: MeetingIntakeStatus.FAILED
    }
  });
}

async function findDraftMultipartUploadIntake(actor: WorkspaceActor, uploadSessionId: string) {
  const intake = await prisma.meetingIntake.findFirst({
    where: { id: uploadSessionId, workspaceId: actor.workspaceId },
    select: {
      analysisJson: true,
      id: true,
      originalFilename: true,
      originalMimeType: true,
      status: true
    }
  });
  if (!intake) throw new ApiError("NOT_FOUND", "Meeting multipart upload session was not found.", 404);
  if (intake.status !== MeetingIntakeStatus.DRAFT) {
    throw new ApiError(
      "MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE",
      "Meeting multipart upload session is already finalized, aborted, or is not waiting for upload completion.",
      409
    );
  }
  return intake;
}

function assertMultipartProviderReady(providerSourceType: MediaExtractionKind) {
  const providerReadiness = getMeetingMediaProviderReadiness();
  if (!providerReadiness.configured) {
    throw new ApiError("MEETING_INTAKE_PROVIDER_NOT_CONFIGURED", mediaProviderRequiredMessage(providerSourceType), 422);
  }
  if (!providerReadiness.supportedSourceTypes.includes(providerSourceType)) {
    throw providerSourceType === "video"
      ? unsupportedVideoError()
      : providerSourceType === "pdf"
        ? unsupportedScannedPdfError()
        : new ApiError("MEETING_INTAKE_PROVIDER_UNAVAILABLE", mediaProviderRequiredMessage(providerSourceType), 422);
  }
}

function validateStoredFileCompletionInput(
  storedFile: StoredMeetingIntelligenceFileRef,
  intake: { originalFilename: string | null; originalMimeType: string | null },
  input: ReturnType<typeof normalizeFinalizeDirectUploadSessionInput>
) {
  if (storedFile.byteLength !== input.byteLength) {
    throw new ApiError(
      "MEETING_INTAKE_STORED_FILE_SIZE_MISMATCH",
      "Uploaded meeting file size did not match the upload session. Upload the meeting artifact again.",
      422
    );
  }
  if (storedFile.sha256 !== input.sha256) {
    throw new ApiError(
      "MEETING_INTAKE_STORED_FILE_CHECKSUM_MISMATCH",
      "Uploaded meeting file checksum did not match the upload session. Upload the meeting artifact again.",
      422
    );
  }
  if (input.explicitSourceType && input.explicitSourceType !== storedFile.sourceType) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file source type does not match the upload session.", 422);
  }
  if (input.originalFilename && intake.originalFilename && input.originalFilename !== intake.originalFilename) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file metadata does not match the upload session.", 422);
  }
  if (input.originalMimeType && intake.originalMimeType && input.originalMimeType !== intake.originalMimeType) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file metadata does not match the upload session.", 422);
  }
}

async function queueOrFailProviderMeetingIntake(
  actor: WorkspaceActor,
  intakeId: string,
  input: NormalizedCreateMeetingIntakeInput,
  detection: SourceDetectionResult,
  providerSourceType: MediaExtractionKind
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
      new ApiError("MEETING_INTAKE_PROVIDER_NOT_CONFIGURED", mediaProviderRequiredMessage(providerSourceType), 422)
    );
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  if (!providerReadiness.supportedSourceTypes.includes(providerSourceType)) {
    const failed = await failMeetingIntake(
      intakeId,
      input,
      detection,
      providerSourceType === "video"
        ? unsupportedVideoError()
        : providerSourceType === "pdf"
          ? unsupportedScannedPdfError()
          : new ApiError("MEETING_INTAKE_PROVIDER_UNAVAILABLE", mediaProviderRequiredMessage(providerSourceType), 422)
    );
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  let storedFile: StoredMeetingIntelligenceFileRef;
  try {
    storedFile = await storeMeetingIntelligenceFile({
      fileBase64: input.fileBase64,
      filename: input.originalFilename,
      intakeId,
      mimeType: input.originalMimeType,
      sourceType: providerSourceType,
      workspaceId: actor.workspaceId
    });
  } catch (error) {
    const failed = await failMeetingIntake(intakeId, input, detection, error);
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  return queueOrFailProviderMeetingIntakeWithStoredFile(actor, intakeId, { ...input, storedFile }, detection, providerSourceType, storedFile);
}

async function queueOrFailProviderMeetingIntakeWithStoredFile(
  actor: WorkspaceActor,
  intakeId: string,
  input: NormalizedCreateMeetingIntakeInput,
  detection: SourceDetectionResult,
  providerSourceType: MediaExtractionKind,
  storedFile: StoredMeetingIntelligenceFileRef,
  _options: MeetingIntelligenceProcessingOptions = {}
) {
  const providerReadiness = getMeetingMediaProviderReadiness();
  if (!providerReadiness.configured) {
    await deleteStoredMeetingIntelligenceFile(storedFile);
    const failed = await failMeetingIntake(
      intakeId,
      input,
      detection,
      new ApiError("MEETING_INTAKE_PROVIDER_NOT_CONFIGURED", mediaProviderRequiredMessage(providerSourceType), 422)
    );
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  if (!providerReadiness.supportedSourceTypes.includes(providerSourceType)) {
    await deleteStoredMeetingIntelligenceFile(storedFile);
    const failed = await failMeetingIntake(
      intakeId,
      input,
      detection,
      providerSourceType === "video"
        ? unsupportedVideoError()
        : providerSourceType === "pdf"
          ? unsupportedScannedPdfError()
          : new ApiError("MEETING_INTAKE_PROVIDER_UNAVAILABLE", mediaProviderRequiredMessage(providerSourceType), 422)
    );
    await writeAuditLog(actor, "meeting_intake.failed", "MeetingIntake", intakeId, {
      sourceType: detection.sourceType,
      message: failed.errorMessage
    });
    return failed;
  }

  let job;
  try {
    job = await enqueueJob({
      dedupeKey: `meeting-intake:${intakeId}:extract-media`,
      maxAttempts: 3,
      payload: toJson({
        actorUserId: actor.actorUserId,
        contextText: input.contextText,
        hints: input.hints,
        intakeId,
        originalFilename: input.originalFilename,
        originalMimeType: input.originalMimeType,
        sourceType: providerSourceType,
        storedFile,
        workspaceId: actor.workspaceId
      }),
      type: meetingMediaExtractionJobType,
      workspaceId: actor.workspaceId
    });
  } catch (error) {
    await deleteStoredMeetingIntelligenceFile(storedFile);
    throw error;
  }
  const queued = await prisma.meetingIntake.update({
    where: { id: intakeId },
    data: {
      analysisJson: toJson({
        detection,
        ...(input.directUploadSession ? { directUploadSession: input.directUploadSession } : {}),
        processorStatus: buildProcessorStatus(detection, input, {
          message: `Queued for ${providerReadiness.providerName ?? "media provider"} extraction.`
        }),
        providerReadiness,
        queuedJobId: job.id,
        storedFile: storedFileForAnalysis(storedFile)
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
  options: { mediaProvider?: MediaExtractionProvider | null; relationshipBriefProvider?: SemanticRelationshipBriefProvider | null } = {}
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
    directUploadSession: undefined,
    storedFile: input.storedFile,
    text: undefined
  };
  const detection = detectMeetingSource({
    explicitSourceType: input.sourceType,
    filename: input.originalFilename,
    mimeType: input.originalMimeType
  });
  const processorDetection = input.sourceType === "pdf" ? scannedPdfProviderDetection(detection) : detection;

  await prisma.meetingIntake.update({
    where: { id: intake.id },
    data: {
      analysisJson: toJson({
        detection: processorDetection,
        processorStatus: buildProcessorStatus(processorDetection, normalizedInput, { message: "Provider extraction is running." }),
        storedFile: input.storedFile ? storedFileForAnalysis(input.storedFile) : undefined
      }),
      errorMessage: null,
      status: MeetingIntakeStatus.EXTRACTING
    }
  });

  try {
    const mediaProvider = options.mediaProvider ?? createConfiguredMeetingMediaProvider();
    const fileBase64 = await fileBase64ForMediaExtractionJob(input);
    const extracted = await extractMeetingText(
      {
        explicitSourceType: detection.sourceType,
        fileBase64,
        filename: input.originalFilename,
        mimeType: input.originalMimeType
      },
      { mediaProvider, preferMediaProvider: input.sourceType === "pdf", providerSourceType: input.sourceType }
    );
    const updated = await finishMeetingIntakeExtraction(actor, intake.id, normalizedInput, processorDetection, extracted, {
      relationshipBriefProvider: options.relationshipBriefProvider
    });
    await deleteStoredMeetingIntelligenceFile(input.storedFile);
    await writeAuditLog(actor, "meeting_intake.created", "MeetingIntake", intake.id, {
      sourceType: detection.sourceType,
      status: updated.status
    });
  } catch (error) {
    await failMeetingIntake(intake.id, normalizedInput, processorDetection, error);
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
  extracted: ExtractedMeetingText,
  options: MeetingIntelligenceProcessingOptions = {}
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
  const analysisInput = {
    contextText: input.contextText,
    markdown: normalized.markdown,
    sourceMetadata: extracted.metadata,
    ...matches
  };
  const analyzedDraft = await deterministicMeetingAnalysisProvider.analyzeMeetingMarkdown(analysisInput);
  const relationshipSemanticExtraction = await enrichRelationshipBriefDraft(analyzedDraft, analysisInput, options);
  const draft = await hydrateRelationshipBriefProposals(actor, relationshipSemanticExtraction.draft);
  draft.warnings = [...extracted.warnings, ...relationshipSemanticExtraction.warnings, ...draft.warnings];
  return prisma.meetingIntake.update({
    where: { id: intakeId },
    data: {
      analysisJson: toJson({
        detection,
        extractionWarnings: extracted.warnings,
        metadata: extracted.metadata,
        processorStatus: buildProcessorStatus(detection, input, { extracted }),
        relationshipSemanticExtraction: relationshipSemanticExtraction.status,
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
    relationshipBriefChanges: [],
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
  for (const relationshipUpdate of approved.relationshipBriefUpdates ?? []) {
    if (!relationshipUpdate.include) {
      result.skipped.push({
        label: targetLabel(relationshipUpdate.target, "relationship brief"),
        reason: "Not selected for apply.",
        type: "relationship_brief"
      });
      continue;
    }
    await applyRelationshipBriefUpdate(actor, relationshipUpdate, result, {
      intakeId: intake.id,
      meetingOccurredAt: approved.meetingActivity?.completedAt ?? draft.meetingActivity?.completedAt,
      meetingTitle: approved.meetingActivity?.title ?? draft.meetingActivity?.title
    });
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

type RelationshipSemanticExtractionStatus = {
  configured: boolean;
  message: string;
  providerId?: string;
  providerName?: string;
  status: "failed_fallback" | "not_configured" | "skipped_no_contacts" | "succeeded";
  warnings?: string[];
};

async function enrichRelationshipBriefDraft(
  draft: MeetingIntelligenceDraft,
  input: Omit<SemanticRelationshipBriefProviderInput, "contacts">,
  options: MeetingIntelligenceProcessingOptions
): Promise<{ draft: MeetingIntelligenceDraft; status: RelationshipSemanticExtractionStatus; warnings: string[] }> {
  const contacts = semanticRelationshipContacts(input.matchedObjects);
  const readiness = relationshipSemanticExtractionReadiness();
  if (contacts.length === 0) {
    return {
      draft,
      status: {
        configured: readiness.configured,
        message: "Semantic Relationship Brief extraction skipped because no confident matched contacts were available.",
        providerId: readiness.providerId === "none" ? undefined : readiness.providerId,
        providerName: readiness.providerName,
        status: "skipped_no_contacts"
      },
      warnings: []
    };
  }

  const provider =
    options.relationshipBriefProvider === undefined
      ? createOpenAISemanticRelationshipBriefProvider()
      : options.relationshipBriefProvider;
  if (!provider) {
    return {
      draft,
      status: {
        configured: false,
        message: readiness.message,
        providerId: readiness.providerId === "none" ? undefined : readiness.providerId,
        providerName: readiness.providerName,
        status: "not_configured"
      },
      warnings: []
    };
  }

  try {
    const semantic = await provider.extract({ ...input, contacts });
    return {
      draft: {
        ...draft,
        relationshipBriefUpdates: mergeRelationshipBriefProposals(draft.relationshipBriefUpdates ?? [], semantic.proposals)
      },
      status: {
        configured: true,
        message: `Semantic Relationship Brief extraction completed through ${provider.name}.`,
        providerId: provider.id,
        providerName: provider.name,
        status: "succeeded",
        warnings: semantic.warnings.length > 0 ? semantic.warnings : undefined
      },
      warnings: semantic.warnings
    };
  } catch (error) {
    const warning = formatMeetingIntakeFailureMessage(
      error,
      "Semantic Relationship Brief extraction was unavailable; deterministic suggestions are shown."
    );
    return {
      draft,
      status: {
        configured: true,
        message: "Semantic Relationship Brief extraction failed; deterministic Relationship Brief suggestions were kept.",
        providerId: provider.id,
        providerName: provider.name,
        status: "failed_fallback",
        warnings: [warning]
      },
      warnings: [warning]
    };
  }
}

function semanticRelationshipContacts(matches: MatchedCrmObject[]) {
  return matches.flatMap((match) => {
    if (match.objectType !== "person" || match.confidence === "ambiguous") return [];
    return [{
      confidence: match.confidence,
      evidenceExcerpt: match.evidenceExcerpt,
      id: match.id,
      label: match.displayName,
      matchedReason: match.matchedReason
    }];
  });
}

function mergeRelationshipBriefProposals(
  base: ProposedRelationshipBriefUpdate[],
  semantic: ProposedRelationshipBriefUpdate[]
) {
  const byTarget = new Map<string, ProposedRelationshipBriefUpdate>();
  for (const proposal of base) {
    if (proposal.target?.type === "person") {
      byTarget.set(proposal.target.id, proposal);
    }
  }

  const merged = [...base];
  for (const proposal of semantic) {
    if (proposal.target?.type !== "person") continue;
    const existing = byTarget.get(proposal.target.id);
    if (!existing) {
      merged.push(proposal);
      byTarget.set(proposal.target.id, proposal);
      continue;
    }
    const next = {
      ...existing,
      confidence: strongerConfidence(existing.confidence, proposal.confidence),
      evidence: uniqueStrings([...existing.evidence, ...proposal.evidence]).slice(0, 6),
      facts: normalizeRelationshipBriefFacts(
        [...(existing.facts ?? relationshipFactsFromFields(existing.proposed, existing)), ...(proposal.facts ?? relationshipFactsFromFields(proposal.proposed, proposal))],
        existing.existing
      ),
      matchedReason: proposal.matchedReason ?? existing.matchedReason,
      proposed: mergeRelationshipBriefFields(existing.proposed, proposal.proposed),
      providerId: proposal.providerId ?? existing.providerId,
      providerName: proposal.providerName ?? existing.providerName,
      sensitivity: uniqueSensitivityGuidance([...(existing.sensitivity ?? []), ...(proposal.sensitivity ?? [])]),
      warnings: uniqueStrings([...(existing.warnings ?? []), ...(proposal.warnings ?? [])]).slice(0, 8)
    };
    byTarget.set(proposal.target.id, next);
    const index = merged.findIndex((candidate) => candidate.target?.type === "person" && candidate.target.id === proposal.target?.id);
    if (index >= 0) merged[index] = next;
  }

  return merged;
}

async function hydrateRelationshipBriefProposals(actor: WorkspaceActor, draft: MeetingIntelligenceDraft): Promise<MeetingIntelligenceDraft> {
  const proposals = draft.relationshipBriefUpdates ?? [];
  const personIds = Array.from(
    new Set(proposals.flatMap((proposal) => proposal.target?.type === "person" ? [proposal.target.id] : []))
  );
  if (personIds.length === 0) return { ...draft, relationshipBriefUpdates: proposals };

  const people = await prisma.person.findMany({
    where: { id: { in: personIds }, workspaceId: actor.workspaceId, ...activeWhere },
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
      relationshipBusinessConcerns: true,
      relationshipCommunicationStyle: true,
      relationshipFollowUpReminders: true,
      relationshipInternalGuidance: true,
      relationshipPersonalContext: true
    }
  });
  const peopleById = new Map(people.map((person) => [person.id, person]));

  return {
    ...draft,
    relationshipBriefUpdates: proposals.map((proposal) => {
      const person = proposal.target?.type === "person" ? peopleById.get(proposal.target.id) : undefined;
      if (!person) {
        return {
          ...proposal,
          existing: {},
          targetWarning: proposal.targetWarning ?? "Selected contact is not available in this workspace."
        };
      }
      return {
        ...proposal,
        existing: relationshipFieldsFromPerson(person),
        facts: normalizeRelationshipBriefFacts(
          proposal.facts ?? relationshipFactsFromFields(proposal.proposed, proposal),
          relationshipFieldsFromPerson(person)
        ),
        mergedPreview: mergeRelationshipBriefFields(
          relationshipFieldsFromPerson(person),
          relationshipProposedFieldsFromFacts(
            normalizeRelationshipBriefFacts(
              proposal.facts ?? relationshipFactsFromFields(proposal.proposed, proposal),
              relationshipFieldsFromPerson(person)
            )
          )
        ),
        target: {
          id: person.id,
          label: formatPersonName(person) ?? person.email ?? "Unnamed contact",
          type: "person"
        }
      };
    })
  };
}

async function applyRelationshipBriefUpdate(
  actor: WorkspaceActor,
  proposal: ProposedRelationshipBriefUpdate,
  result: ApplyMeetingIntelligenceResult,
  source: { intakeId: string; meetingOccurredAt?: string; meetingTitle?: string }
) {
  const targetValidation = await validateApplyTarget(actor, proposal.target);
  if (!targetValidation.target || targetValidation.target.type !== "person") {
    result.skipped.push({
      label: targetLabel(proposal.target, "relationship brief"),
      reason: targetValidation.reason ?? "Relationship Brief updates require a contact target.",
      type: "relationship_brief"
    });
    return;
  }

  const person = await prisma.person.findFirst({
    where: { id: targetValidation.target.id, workspaceId: actor.workspaceId, ...activeWhere },
    select: {
      id: true,
      relationshipBusinessConcerns: true,
      relationshipCommunicationStyle: true,
      relationshipFollowUpReminders: true,
      relationshipInternalGuidance: true,
      relationshipPersonalContext: true
    }
  });
  if (!person) {
    result.skipped.push({
      label: targetLabel(targetValidation.target, "relationship brief"),
      reason: "Selected target is not available in this workspace.",
      type: "relationship_brief"
    });
    return;
  }

  const current = relationshipFieldsFromPerson(person);
  const selectedFacts = normalizeRelationshipBriefFacts(proposal.facts ?? relationshipFactsFromFields(proposal.proposed, proposal), current);
  const selectedProposed = relationshipProposedFieldsFromFacts(selectedFacts);
  const merged = mergeRelationshipBriefFields(current, selectedProposed);
  const payload = relationshipUpdatePayload(current, merged);
  if (Object.keys(payload).length === 0) {
    result.skipped.push({
      label: targetLabel(targetValidation.target, "relationship brief"),
      reason: "No new Relationship Brief details were selected.",
      type: "relationship_brief"
    });
    return;
  }

  if (Object.values(payload).some((value) => typeof value === "string" && value.length > 2000)) {
    result.skipped.push({
      label: targetLabel(targetValidation.target, "relationship brief"),
      reason: "Merged Relationship Brief field would exceed 2,000 characters.",
      type: "relationship_brief"
    });
    return;
  }

  try {
    const changedAt = new Date().toISOString();
    const changes = relationshipBriefChangeSummaries({
      actorId: actor.actorUserId,
      changedAt,
      current,
      merged,
      selectedFacts,
      source,
      target: {
        id: targetValidation.target.id,
        label: targetValidation.target.label ?? targetValidation.target.id,
        type: "person"
      }
    });
    await updatePerson(actor, targetValidation.target.id, payload, {
      auditMetadata: {
        relationshipBriefChanges: changes,
        source: {
          intakeId: source.intakeId,
          occurredAt: source.meetingOccurredAt,
          title: source.meetingTitle,
          type: "meeting_intelligence"
        }
      }
    });
    result.relationshipBriefChanges?.push(...changes);
    result.created.push({
      href: `/contacts/${targetValidation.target.id}`,
      id: targetValidation.target.id,
      label: `Relationship Brief updated for ${targetValidation.target.label ?? targetValidation.target.id}`,
      type: "relationship_brief"
    });
  } catch (error) {
    result.skipped.push({
      label: targetLabel(targetValidation.target, "relationship brief"),
      reason: formatMeetingIntakeFailureMessage(error, "Could not update Relationship Brief."),
      type: "relationship_brief"
    });
  }
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
      description: meetingIntelligenceActivityDescription(activity.description ?? null, label),
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

function meetingIntelligenceActivityDescription(description: string | null, label: string) {
  const sourceLine = `Source: Meeting Intelligence ${label}.`;
  const trimmed = description?.trim();
  if (!trimmed) return sourceLine;
  if (trimmed.includes("Source: Meeting Intelligence")) return trimmed;
  return `${sourceLine}\n\n${trimmed}`;
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

async function fileBase64ForMediaExtractionJob(input: MeetingMediaExtractionJobPayload) {
  if (input.storedFile) {
    const stored = await readStoredMeetingIntelligenceFile(input.storedFile);
    return Buffer.from(stored.bytes).toString("base64");
  }
  if (input.fileBase64) return input.fileBase64;
  throw new ApiError(
    "MEETING_INTAKE_STORED_FILE_MISSING",
    "Stored meeting file is missing or expired. Upload the meeting artifact again.",
    410
  );
}

function storedFileForAnalysis(ref: StoredMeetingIntelligenceFileRef) {
  return {
    backend: ref.backend,
    byteLength: ref.byteLength,
    createdAt: ref.createdAt,
    expiresAt: ref.expiresAt,
    filename: ref.filename,
    key: ref.key,
    mimeType: ref.mimeType,
    sha256: ref.sha256,
    sourceType: ref.sourceType
  };
}

export async function cleanupMeetingIntelligenceStoredFiles(options: { now?: Date } = {}) {
  const activeKeys = await activeMeetingIntelligenceStoredFileKeys();
  return cleanupExpiredStoredMeetingIntelligenceFiles({
    activeKeys,
    now: options.now
  });
}

async function activeMeetingIntelligenceStoredFileKeys() {
  const activeKeys = new Set<string>();
  const [jobs, intakes] = await Promise.all([
    prisma.job.findMany({
      where: {
        type: meetingMediaExtractionJobType,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.FAILED] }
      },
      select: { payload: true }
    }),
    prisma.meetingIntake.findMany({
      where: { status: MeetingIntakeStatus.EXTRACTING },
      select: { analysisJson: true }
    })
  ]);

  for (const job of jobs) addStoredFileKey(activeKeys, job.payload);
  for (const intake of intakes) addStoredFileKey(activeKeys, intake.analysisJson);
  return activeKeys;
}

function addStoredFileKey(activeKeys: Set<string>, value: unknown) {
  const input = objectInput(value);
  for (const candidate of [input.storedFile, objectInput(input.processorStatus).storedFile]) {
    const storedFile = normalizeStoredMeetingIntelligenceFileRef(candidate);
    if (storedFile) activeKeys.add(storedFile.key);
  }
}

function isScannedPdfOcrRequired(error: unknown, detection: SourceDetectionResult) {
  return detection.sourceType === "pdf" && error instanceof ApiError && error.code === "MEETING_INTAKE_OCR_REQUIRED";
}

function scannedPdfProviderDetection(detection: SourceDetectionResult): SourceDetectionResult {
  return {
    ...detection,
    capability: "provider_required",
    conversionMode: "provider_required",
    extractionMethod: "provider-required",
    message: "Scanned or image-only PDF extraction requires an OCR or vision provider.",
    requiredProvider: "ocr_or_vision",
    sourceType: "pdf"
  };
}

function relationshipFieldsFromPerson(person: {
  relationshipBusinessConcerns: string | null;
  relationshipCommunicationStyle: string | null;
  relationshipFollowUpReminders: string | null;
  relationshipInternalGuidance: string | null;
  relationshipPersonalContext: string | null;
}): RelationshipBriefFields {
  return compactRelationshipFields({
    relationshipBusinessConcerns: person.relationshipBusinessConcerns ?? undefined,
    relationshipCommunicationStyle: person.relationshipCommunicationStyle ?? undefined,
    relationshipFollowUpReminders: person.relationshipFollowUpReminders ?? undefined,
    relationshipInternalGuidance: person.relationshipInternalGuidance ?? undefined,
    relationshipPersonalContext: person.relationshipPersonalContext ?? undefined
  });
}

function mergeRelationshipBriefFields(current: RelationshipBriefFields, proposed: RelationshipBriefFields): RelationshipBriefFields {
  return compactRelationshipFields({
    relationshipBusinessConcerns: mergeRelationshipField(
      current.relationshipBusinessConcerns,
      proposed.relationshipBusinessConcerns
    ),
    relationshipCommunicationStyle: mergeRelationshipField(
      current.relationshipCommunicationStyle,
      proposed.relationshipCommunicationStyle
    ),
    relationshipFollowUpReminders: mergeRelationshipField(
      current.relationshipFollowUpReminders,
      proposed.relationshipFollowUpReminders
    ),
    relationshipInternalGuidance: mergeRelationshipField(
      current.relationshipInternalGuidance,
      proposed.relationshipInternalGuidance
    ),
    relationshipPersonalContext: mergeRelationshipField(
      current.relationshipPersonalContext,
      proposed.relationshipPersonalContext
    )
  });
}

function mergeRelationshipField(current: string | undefined, proposed: string | undefined) {
  const next = proposed?.trim();
  if (!next) return current;
  const existing = current?.trim();
  if (!existing) return next;
  if (existing.toLowerCase().includes(next.toLowerCase())) return existing;
  return `${existing}\n\n${next}`;
}

function relationshipUpdatePayload(current: RelationshipBriefFields, merged: RelationshipBriefFields) {
  const payload: Record<string, string> = {};
  for (const key of relationshipBriefFieldKeys) {
    const next = merged[key]?.trim();
    if (next && next !== current[key]?.trim()) payload[key] = next;
  }
  return payload;
}

function relationshipBriefChangeSummaries({
  actorId,
  changedAt,
  current,
  merged,
  selectedFacts,
  source,
  target
}: {
  actorId: string;
  changedAt: string;
  current: RelationshipBriefFields;
  merged: RelationshipBriefFields;
  selectedFacts: ProposedRelationshipBriefFact[];
  source: { intakeId: string; meetingOccurredAt?: string; meetingTitle?: string };
  target: RelationshipBriefChangeSummary["target"];
}): RelationshipBriefChangeSummary[] {
  return relationshipBriefFieldKeys.flatMap((field) => {
    const previousValue = current[field]?.trim() || null;
    const newValue = merged[field]?.trim() || null;
    if (previousValue === newValue) return [];
    const acceptedFacts = uniqueStrings(
      selectedFacts
        .filter((fact) => fact.include && fact.field === field)
        .map((fact) => fact.text.trim())
        .filter(Boolean)
    );
    return [{
      acceptedFactCount: acceptedFacts.length,
      acceptedFacts,
      actorId,
      changedAt,
      field,
      fieldLabel: relationshipBriefFieldLabel(field),
      newValue,
      previousValue,
      source: {
        intakeId: source.intakeId,
        occurredAt: source.meetingOccurredAt,
        title: source.meetingTitle,
        type: "meeting_intelligence"
      },
      target
    }];
  });
}

function relationshipFactsFromFields(
  fields: RelationshipBriefFields,
  proposal: Pick<ProposedRelationshipBriefUpdate, "evidence" | "id" | "sensitivity" | "warnings">
): ProposedRelationshipBriefFact[] {
  return relationshipBriefFieldKeys.flatMap((field) =>
    splitRelationshipFacts(fields[field]).map((text, index) => ({
      evidence: proposal.evidence,
      field,
      id: `${proposal.id}-${field}-${index + 1}`,
      include: true,
      sensitivity: proposal.sensitivity?.filter((item) => !item.field || item.field === field),
      text,
      warnings: proposal.warnings
    }))
  );
}

function normalizeRelationshipBriefFacts(
  facts: ProposedRelationshipBriefFact[],
  existing: RelationshipBriefFields
): ProposedRelationshipBriefFact[] {
  const seen = new Set<string>();
  return facts.flatMap((fact, index) => {
    const text = fact.text.trim();
    const field = normalizeRelationshipBriefFieldKey(fact.field) ?? "relationshipPersonalContext";
    if (!text) return [];
    const key = `${field}:${normalizeRelationshipText(text)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const duplicateOfExisting = relationshipFactExists(existing[field], text);
    return [{
      ...fact,
      duplicateOfExisting,
      field,
      id: fact.id || `relationship-fact-${field}-${index + 1}`,
      include: fact.include && !duplicateOfExisting,
      staleWarning: fact.staleWarning ?? staleRelationshipFactWarning(text),
      text,
      warnings: uniqueStrings(fact.warnings ?? []).slice(0, 4)
    }];
  });
}

function relationshipProposedFieldsFromFacts(facts: ProposedRelationshipBriefFact[]): RelationshipBriefFields {
  const fields: RelationshipBriefFields = {};
  for (const field of relationshipBriefFieldKeys) {
    const selected = facts
      .filter((fact) => fact.include && fact.field === field)
      .map((fact) => fact.text.trim())
      .filter(Boolean);
    if (selected.length > 0) fields[field] = uniqueStrings(selected).join("\n");
  }
  return fields;
}

function splitRelationshipFacts(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/\n{1,}|\s[•]\s/g)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function relationshipFactExists(existing: string | undefined, fact: string) {
  const existingNormalized = normalizeRelationshipText(existing ?? "");
  const factNormalized = normalizeRelationshipText(fact);
  return Boolean(factNormalized && existingNormalized.includes(factNormalized));
}

function normalizeRelationshipText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function staleRelationshipFactWarning(value: string) {
  if (/\b(next week|tomorrow|today|yesterday|last week|this week|this month|next month)\b/i.test(value)) {
    return "Time-sensitive fact; review whether it will stay useful.";
  }
  if (/\b(?:19|20)\d{2}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(value)) {
    return "Date-specific fact; review for staleness before saving.";
  }
  if (/\btrip|vacation|conference|event|launch|go-live|go live\b/i.test(value)) {
    return "May become stale; review after the event passes.";
  }
  return undefined;
}

function normalizeRelationshipBriefFieldKey(value: unknown): keyof RelationshipBriefFields | undefined {
  return relationshipBriefFieldKeys.find((key) => key === value);
}

const relationshipBriefFieldKeys = [
  "relationshipPersonalContext",
  "relationshipCommunicationStyle",
  "relationshipBusinessConcerns",
  "relationshipFollowUpReminders",
  "relationshipInternalGuidance"
] as const satisfies Array<keyof RelationshipBriefFields>;

function relationshipBriefFieldLabel(field: keyof RelationshipBriefFields) {
  if (field === "relationshipBusinessConcerns") return "Business concerns";
  if (field === "relationshipCommunicationStyle") return "Communication style";
  if (field === "relationshipFollowUpReminders") return "Follow-up reminders";
  if (field === "relationshipInternalGuidance") return "Internal guidance";
  return "Personal context";
}

function compactRelationshipFields(fields: RelationshipBriefFields): RelationshipBriefFields {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, value?.trim()])
      .filter((entry): entry is [keyof RelationshipBriefFields, string] => Boolean(entry[1]))
  ) as RelationshipBriefFields;
}

function strongerConfidence(
  first: ProposedRelationshipBriefUpdate["confidence"],
  second: ProposedRelationshipBriefUpdate["confidence"]
) {
  const rank = { ambiguous: 0, low: 1, medium: 2, high: 3 };
  if (!first) return second;
  if (!second) return first;
  return rank[second] > rank[first] ? second : first;
}

function uniqueSensitivityGuidance(values: RelationshipBriefSensitivityGuidance[]) {
  const seen = new Set<string>();
  const result: RelationshipBriefSensitivityGuidance[] = [];
  for (const value of values) {
    const key = `${value.category}:${value.field ?? ""}:${value.guidance}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.length > 0 ? result.slice(0, 8) : undefined;
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
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
  storedFile?: ReturnType<typeof storedFileForAnalysis>;
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
  if (input.storedFile) status.storedFile = storedFileForAnalysis(input.storedFile);
  if (warnings?.length) status.warnings = warnings;
  return status;
}

function normalizeCreateMeetingIntakeInput(data: CreateMeetingIntakeInput) {
  const input = objectInput(data);
  return {
    contextText: normalizeOptionalText(input.contextText, 20_000),
    explicitSourceType: normalizeSourceType(input.explicitSourceType),
    fileBase64: normalizeOptionalBase64(input.fileBase64, maxMeetingIntakeFileBase64Length),
    fileText: normalizeOptionalText(input.fileText, 120_000),
    hints: normalizeHints(input.hints),
    originalFilename: normalizeOptionalText(input.originalFilename, 255),
    originalMimeType: normalizeOptionalText(input.originalMimeType, 255),
    directUploadSession: undefined as { mode?: "direct" | "multipart"; status: "queued" } | undefined,
    storedFile: undefined as StoredMeetingIntelligenceFileRef | undefined,
    text: normalizeOptionalText(input.text, 120_000)
  };
}

function normalizeCreateDirectUploadSessionInput(data: CreateMeetingIntakeDirectUploadSessionInput) {
  const input = objectInput(data);
  return {
    byteLength: normalizeRequiredPositiveInteger(input.byteLength, "Meeting direct upload byte length is required."),
    explicitSourceType: normalizeSourceType(input.explicitSourceType),
    originalFilename: normalizeOptionalText(input.originalFilename, 255),
    originalMimeType: normalizeOptionalText(input.originalMimeType, 255),
    sha256: normalizeRequiredSha256(input.sha256)
  };
}

function normalizeCreateMultipartUploadSessionInput(data: CreateMeetingIntakeMultipartUploadSessionInput) {
  const input = normalizeCreateDirectUploadSessionInput(data);
  return {
    ...input,
    partSizeBytes: integerInput(objectInput(data).partSizeBytes)
  };
}

function normalizeFinalizeDirectUploadSessionInput(data: FinalizeMeetingIntakeDirectUploadSessionInput) {
  const input = objectInput(data);
  return {
    byteLength: normalizeRequiredPositiveInteger(input.byteLength, "Meeting direct upload byte length is required."),
    contextText: normalizeOptionalText(input.contextText, 20_000),
    explicitSourceType: normalizeSourceType(input.explicitSourceType),
    hints: normalizeHints(input.hints),
    originalFilename: normalizeOptionalText(input.originalFilename, 255),
    originalMimeType: normalizeOptionalText(input.originalMimeType, 255),
    sha256: normalizeRequiredSha256(input.sha256)
  };
}

function normalizeSignMultipartUploadPartsInput(data: SignMeetingIntakeMultipartUploadPartsInput) {
  const input = objectInput(data);
  return {
    partNumbers: normalizeIntegerArray(input.partNumbers, 100)
  };
}

function normalizeCompleteMultipartUploadSessionInput(data: CompleteMeetingIntakeMultipartUploadSessionInput) {
  return {
    ...normalizeFinalizeDirectUploadSessionInput(data),
    parts: normalizeMultipartParts(objectInput(data).parts)
  };
}

function directUploadProviderSourceType(sourceType: MeetingSourceType): MediaExtractionKind {
  if (sourceType === "audio" || sourceType === "image" || sourceType === "pdf" || sourceType === "video") {
    return sourceType;
  }
  throw new ApiError(
    "MEETING_INTAKE_DIRECT_UPLOAD_UNSUPPORTED",
    "Direct Meeting Intelligence uploads are only available for provider-backed image, scanned PDF, audio, and video files.",
    422
  );
}

function storedFileFromDirectUploadSession(value: unknown) {
  const input = objectInput(value);
  return normalizeStoredMeetingIntelligenceFileRef(input.storedFile) ??
    normalizeStoredMeetingIntelligenceFileRef(objectInput(input.directUploadSession).storedFile) ??
    normalizeStoredMeetingIntelligenceFileRef(objectInput(input.multipartUploadSession).storedFile) ??
    normalizeStoredMeetingIntelligenceFileRef(objectInput(input.processorStatus).storedFile);
}

function parseMeetingMediaExtractionJobPayload(payload: unknown): MeetingMediaExtractionJobPayload {
  const input = objectInput(payload);
  const actorUserId = normalizeOptionalText(input.actorUserId, 120);
  const fileBase64 = normalizeOptionalBase64(input.fileBase64, 12_000_000);
  const intakeId = normalizeOptionalText(input.intakeId, 120);
  const sourceType = input.sourceType;
  const storedFile = normalizeStoredMeetingIntelligenceFileRef(input.storedFile);
  const workspaceId = normalizeOptionalText(input.workspaceId, 120);

  if (
    !actorUserId ||
    (!fileBase64 && !storedFile) ||
    !intakeId ||
    !(sourceType === "audio" || sourceType === "image" || sourceType === "pdf" || sourceType === "video") ||
    !workspaceId
  ) {
    throw new Error("Invalid meeting media extraction job payload.");
  }
  if (storedFile && (storedFile.workspaceId !== workspaceId || storedFile.intakeId !== intakeId || storedFile.sourceType !== sourceType)) {
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
    storedFile: storedFile ?? undefined,
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
    nextStepActivities: normalizeNextActivities(input.nextStepActivities, draft.nextStepActivities),
    relationshipBriefUpdates: normalizeRelationshipBriefUpdates(input.relationshipBriefUpdates, draft.relationshipBriefUpdates ?? [])
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

function normalizeRelationshipBriefUpdates(
  value: unknown,
  fallback: NonNullable<MeetingIntelligenceDraft["relationshipBriefUpdates"]>
) {
  const values = Array.isArray(value) ? value : [];
  return fallback.map((proposal, index) => {
    const input = objectInput(values[index]);
    const facts = normalizeReviewRelationshipBriefFacts(input.facts, proposal);
    const proposed = facts
      ? relationshipProposedFieldsFromFacts(facts)
      : normalizeRelationshipBriefFields(input.proposed, proposal.proposed);
    return {
      ...proposal,
      facts: facts ?? normalizeRelationshipBriefFacts(proposal.facts ?? relationshipFactsFromFields(proposed, proposal), proposal.existing),
      include: normalizeBoolean(input.include, proposal.include),
      mergedPreview: mergeRelationshipBriefFields(proposal.existing, proposed),
      proposed,
      target: normalizeRelationshipBriefTarget(input.target, proposal.target)
    };
  });
}

function normalizeReviewRelationshipBriefFacts(
  value: unknown,
  proposal: ProposedRelationshipBriefUpdate
): ProposedRelationshipBriefFact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fallbackFacts = normalizeRelationshipBriefFacts(
    proposal.facts ?? relationshipFactsFromFields(proposal.proposed, proposal),
    proposal.existing
  );
  return fallbackFacts.map((fact, index) => {
    const input = objectInput(value[index]);
    return {
      ...fact,
      field: normalizeRelationshipBriefFieldKey(input.field) ?? fact.field,
      include: normalizeBoolean(input.include, fact.include),
      text: normalizeOptionalText(input.text, 2000) ?? ""
    };
  });
}

function normalizeRelationshipBriefFields(value: unknown, fallback: RelationshipBriefFields): RelationshipBriefFields {
  const input = objectInput(value);
  return compactRelationshipFields({
    relationshipPersonalContext: normalizeRelationshipBriefField(input, "relationshipPersonalContext", fallback),
    relationshipCommunicationStyle: normalizeRelationshipBriefField(input, "relationshipCommunicationStyle", fallback),
    relationshipBusinessConcerns: normalizeRelationshipBriefField(input, "relationshipBusinessConcerns", fallback),
    relationshipFollowUpReminders: normalizeRelationshipBriefField(input, "relationshipFollowUpReminders", fallback),
    relationshipInternalGuidance: normalizeRelationshipBriefField(input, "relationshipInternalGuidance", fallback)
  });
}

function normalizeRelationshipBriefField(
  input: Record<string, unknown>,
  key: keyof RelationshipBriefFields,
  fallback: RelationshipBriefFields
) {
  if (!Object.prototype.hasOwnProperty.call(input, key)) return fallback[key];
  return normalizeOptionalText(input[key], 2000);
}

function normalizeRelationshipBriefTarget(value: unknown, fallback: CrmTarget | null): CrmTarget | null {
  const target = normalizeTarget(value, fallback);
  if (!target) return null;
  if (target.type !== "person") return null;
  return target;
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

function normalizeRequiredPositiveInteger(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  return value;
}

function normalizeRequiredSha256(value: unknown) {
  const text = normalizeOptionalText(value, 64);
  if (!text || !/^[a-f0-9]{64}$/i.test(text)) {
    throw new ApiError("VALIDATION_ERROR", "Meeting direct upload checksum is invalid.", 422);
  }
  return text.toLowerCase();
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

function normalizeIntegerArray(value: unknown, maxLength: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    throw new ApiError("VALIDATION_ERROR", "Multipart upload part numbers are invalid.", 422);
  }
  const values = value.map(integerInput);
  if (values.some((item) => item === undefined)) {
    throw new ApiError("VALIDATION_ERROR", "Multipart upload part numbers are invalid.", 422);
  }
  return values as number[];
}

function normalizeMultipartParts(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) {
    throw new ApiError("VALIDATION_ERROR", "Multipart upload part metadata is invalid.", 422);
  }
  return value.map((item) => {
    const input = objectInput(item);
    const partNumber = integerInput(input.partNumber);
    const etag = normalizeOptionalText(input.etag, 200);
    if (!partNumber || !etag || /[\r\n<>]/.test(etag)) {
      throw new ApiError("VALIDATION_ERROR", "Multipart upload part metadata is invalid.", 422);
    }
    return { etag, partNumber };
  });
}

function integerInput(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function formatMegabytes(bytes: number) {
  return Math.floor(bytes / (1024 * 1024));
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
