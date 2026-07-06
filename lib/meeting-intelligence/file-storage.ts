import { createHash, createHmac, randomUUID } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { ApiError } from "@/lib/api/responses";

import type { MediaExtractionKind } from "./media-providers";

export const localMeetingIntelligenceFileStorageBackend = "local-filesystem";
export const s3MeetingIntelligenceFileStorageBackend = "s3-compatible";
export const meetingIntelligenceFileStorageBackend = localMeetingIntelligenceFileStorageBackend;
export const defaultMeetingIntelligenceFileStorageRetentionDays = 7;
export const defaultMeetingIntelligenceFileStorageMaxBytes = 50 * 1024 * 1024;
export const defaultMeetingIntelligenceDirectUploadExpiresInSeconds = 15 * 60;
export const defaultMeetingIntelligenceMultipartUploadPartSizeBytes = 8 * 1024 * 1024;
export const defaultMeetingIntelligenceMultipartUploadMaxParts = 10_000;
export const defaultMeetingIntelligenceSingleObjectDirectUploadMaxBytes = 25 * 1024 * 1024;

export type MeetingIntelligenceFileStorageBackend =
  | typeof localMeetingIntelligenceFileStorageBackend
  | typeof s3MeetingIntelligenceFileStorageBackend;

export type MeetingIntelligenceFileStorageEnv = {
  [key: string]: string | undefined;
  MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND?: string;
  MEETING_INTELLIGENCE_FILE_STORAGE_DIR?: string;
  MEETING_INTELLIGENCE_FILE_STORAGE_MAX_MB?: string;
  MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS?: string;
  MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID?: string;
  MEETING_INTELLIGENCE_S3_BUCKET?: string;
  MEETING_INTELLIGENCE_S3_ENDPOINT?: string;
  MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE?: string;
  MEETING_INTELLIGENCE_S3_REGION?: string;
  MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY?: string;
};

export type StoredMeetingIntelligenceFileRef = {
  backend: MeetingIntelligenceFileStorageBackend;
  byteLength: number;
  createdAt: string;
  expiresAt: string;
  filename?: string;
  key: string;
  mimeType?: string;
  sha256: string;
  sourceType: MediaExtractionKind;
  workspaceId: string;
  intakeId: string;
};

export type StoreMeetingIntelligenceFileInput = {
  fileBase64: string;
  filename?: string;
  intakeId: string;
  mimeType?: string;
  now?: Date;
  sourceType: MediaExtractionKind;
  workspaceId: string;
};

export type CreateMeetingIntelligenceDirectUploadInput = {
  byteLength: number;
  filename?: string;
  intakeId: string;
  mimeType?: string;
  now?: Date;
  sha256: string;
  sourceType: MediaExtractionKind;
  uploadExpiresInSeconds?: number;
  workspaceId: string;
};

export type CreateMeetingIntelligenceMultipartUploadInput = CreateMeetingIntelligenceDirectUploadInput & {
  partSizeBytes?: number;
};

export type MeetingIntelligenceDirectUploadTarget = {
  storedFile: StoredMeetingIntelligenceFileRef;
  upload: {
    expiresAt: string;
    headers: Record<string, string>;
    method: "PUT";
    url: string;
  };
};

export type MeetingIntelligenceMultipartUploadTarget = {
  multipart: {
    abortSupported: true;
    expiresAt: string;
    maxParts: number;
    partCount: number;
    partSizeBytes: number;
    signPartExpiresInSeconds: number;
  };
  storedFile: StoredMeetingIntelligenceFileRef;
};

export type MeetingIntelligenceMultipartUploadPart = {
  etag: string;
  partNumber: number;
};

export type MeetingIntelligenceMultipartUploadPartTarget = {
  expiresAt: string;
  partNumber: number;
  upload: {
    headers: Record<string, string>;
    method: "PUT";
    url: string;
  };
};

export type CleanupStoredMeetingIntelligenceFilesResult = {
  deleted: number;
  failed: Array<{ key?: string; reason: string }>;
  scanned: number;
  skippedActive: number;
};

type MeetingIntelligenceFileStorageConfig = {
  backend: MeetingIntelligenceFileStorageBackend;
  local: { rootDir: string };
  maxBytes: number;
  retentionDays: number;
  s3?: S3CompatibleStorageConfig;
};

type S3CompatibleStorageConfig = {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
};

type S3RequestInput = {
  body?: Buffer;
  contentType?: string;
  method: "DELETE" | "GET" | "POST" | "PUT";
  objectKey?: string;
  query?: Record<string, string | undefined>;
};

type StoredMeetingIntelligenceMultipartMetadata = StoredMeetingIntelligenceFileRef & {
  multipartUpload?: {
    maxParts: number;
    partCount: number;
    partSizeBytes: number;
    status: "awaiting_parts";
    uploadId: string;
  };
};

export function getMeetingIntelligenceFileStorageConfig(
  env: MeetingIntelligenceFileStorageEnv = process.env
): MeetingIntelligenceFileStorageConfig {
  const backend = readStorageBackend(env.MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND);
  return {
    backend,
    local: {
      rootDir: resolve(
        readNonEmpty(env.MEETING_INTELLIGENCE_FILE_STORAGE_DIR) ?? join(process.cwd(), ".northstar-private", "meeting-intelligence-files")
      )
    },
    maxBytes: readPositiveInteger(env.MEETING_INTELLIGENCE_FILE_STORAGE_MAX_MB, defaultMeetingIntelligenceFileStorageMaxBytes / (1024 * 1024)) * 1024 * 1024,
    retentionDays: readPositiveInteger(
      env.MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS,
      defaultMeetingIntelligenceFileStorageRetentionDays
    ),
    s3: backend === s3MeetingIntelligenceFileStorageBackend ? readS3Config(env) : undefined
  };
}

export async function storeMeetingIntelligenceFile(
  input: StoreMeetingIntelligenceFileInput,
  env: MeetingIntelligenceFileStorageEnv = process.env
): Promise<StoredMeetingIntelligenceFileRef> {
  const config = getMeetingIntelligenceFileStorageConfig(env);
  const bytes = Buffer.from(input.fileBase64, "base64");
  assertStorageByteLength(bytes.byteLength, config.maxBytes, input.sourceType);

  const now = input.now ?? new Date();
  const ref = buildStoredFileRef(config, {
    byteLength: bytes.byteLength,
    filename: input.filename,
    intakeId: input.intakeId,
    mimeType: input.mimeType,
    now,
    sha256: sha256(bytes),
    sourceType: input.sourceType,
    workspaceId: input.workspaceId
  });

  if (config.backend === s3MeetingIntelligenceFileStorageBackend) {
    await storeS3File(config, ref, bytes);
    return ref;
  }

  await storeLocalFile(config, ref, bytes);
  return ref;
}

export async function createMeetingIntelligenceDirectUploadTarget(
  input: CreateMeetingIntelligenceDirectUploadInput,
  env: MeetingIntelligenceFileStorageEnv = process.env
): Promise<MeetingIntelligenceDirectUploadTarget> {
  const config = getMeetingIntelligenceFileStorageConfig(env);
  if (config.backend !== s3MeetingIntelligenceFileStorageBackend) {
    throw new ApiError(
      "MEETING_INTAKE_DIRECT_UPLOAD_UNAVAILABLE",
      "Direct Meeting Intelligence uploads require S3-compatible file storage.",
      422
    );
  }
  assertStorageByteLength(input.byteLength, config.maxBytes, input.sourceType);
  assertSha256(input.sha256);

  const now = input.now ?? new Date();
  const uploadExpiresInSeconds = Math.min(
    readPositiveInteger(input.uploadExpiresInSeconds?.toString(), defaultMeetingIntelligenceDirectUploadExpiresInSeconds),
    defaultMeetingIntelligenceDirectUploadExpiresInSeconds
  );
  const uploadExpiresAt = new Date(now.getTime() + uploadExpiresInSeconds * 1000);
  const ref = buildStoredFileRef(config, {
    byteLength: input.byteLength,
    filename: input.filename,
    intakeId: input.intakeId,
    mimeType: input.mimeType,
    now,
    sha256: input.sha256.toLowerCase(),
    sourceType: input.sourceType,
    workspaceId: input.workspaceId
  });

  await putS3Metadata(config, ref);
  return {
    storedFile: ref,
    upload: {
      expiresAt: uploadExpiresAt.toISOString(),
      headers: { "content-type": input.mimeType ?? "application/octet-stream" },
      method: "PUT",
      url: createS3PresignedPutUrl(config, contentObjectKey(ref.key), now, uploadExpiresInSeconds)
    }
  };
}

export async function createMeetingIntelligenceMultipartUploadTarget(
  input: CreateMeetingIntelligenceMultipartUploadInput,
  env: MeetingIntelligenceFileStorageEnv = process.env
): Promise<MeetingIntelligenceMultipartUploadTarget> {
  const config = getMeetingIntelligenceFileStorageConfig(env);
  if (config.backend !== s3MeetingIntelligenceFileStorageBackend) {
    throw new ApiError(
      "MEETING_INTAKE_MULTIPART_UPLOAD_UNAVAILABLE",
      "Multipart Meeting Intelligence uploads require S3-compatible file storage.",
      422
    );
  }
  assertStorageByteLength(input.byteLength, config.maxBytes, input.sourceType);
  assertSha256(input.sha256);

  const partSizeBytes = normalizeMultipartPartSize(input.partSizeBytes);
  const partCount = Math.ceil(input.byteLength / partSizeBytes);
  if (partCount > defaultMeetingIntelligenceMultipartUploadMaxParts) {
    throw new ApiError(
      "MEETING_INTAKE_MULTIPART_TOO_MANY_PARTS",
      "Multipart Meeting Intelligence upload would exceed the maximum supported part count.",
      422
    );
  }

  const now = input.now ?? new Date();
  const uploadExpiresInSeconds = Math.min(
    readPositiveInteger(input.uploadExpiresInSeconds?.toString(), defaultMeetingIntelligenceDirectUploadExpiresInSeconds),
    defaultMeetingIntelligenceDirectUploadExpiresInSeconds
  );
  const ref = buildStoredFileRef(config, {
    byteLength: input.byteLength,
    filename: input.filename,
    intakeId: input.intakeId,
    mimeType: input.mimeType,
    now,
    sha256: input.sha256.toLowerCase(),
    sourceType: input.sourceType,
    workspaceId: input.workspaceId
  });
  const uploadId = await createS3MultipartUpload(config, ref, input.mimeType ?? "application/octet-stream");
  try {
    await putS3MultipartMetadata(config, ref, {
      maxParts: defaultMeetingIntelligenceMultipartUploadMaxParts,
      partCount,
      partSizeBytes,
      status: "awaiting_parts",
      uploadId
    });
  } catch (error) {
    await abortS3MultipartUpload(config, ref.key, uploadId).catch(() => undefined);
    throw error;
  }

  return {
    multipart: {
      abortSupported: true,
      expiresAt: ref.expiresAt,
      maxParts: defaultMeetingIntelligenceMultipartUploadMaxParts,
      partCount,
      partSizeBytes,
      signPartExpiresInSeconds: uploadExpiresInSeconds
    },
    storedFile: ref
  };
}

export async function createMeetingIntelligenceMultipartUploadPartTargets(
  ref: StoredMeetingIntelligenceFileRef,
  input: { partNumbers: number[]; uploadExpiresInSeconds?: number },
  options: { now?: Date; env?: MeetingIntelligenceFileStorageEnv } = {}
): Promise<MeetingIntelligenceMultipartUploadPartTarget[]> {
  const config = getMeetingIntelligenceFileStorageConfig(options.env ?? process.env);
  if (config.backend !== s3MeetingIntelligenceFileStorageBackend || ref.backend !== s3MeetingIntelligenceFileStorageBackend) {
    throw new ApiError(
      "MEETING_INTAKE_MULTIPART_UPLOAD_UNAVAILABLE",
      "Multipart Meeting Intelligence uploads require S3-compatible file storage.",
      422
    );
  }
  const metadata = await readS3MultipartMetadata(config, ref.key);
  validateStoredMetadata(metadata, ref, options.now ?? new Date());
  const multipartUpload = metadata.multipartUpload;
  if (!multipartUpload?.uploadId) throw new ApiError("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID", "Multipart upload session is invalid.", 422);
  const uploadId = multipartUpload.uploadId;
  const partNumbers = normalizePartNumbers(input.partNumbers, multipartUpload.partCount);
  const now = options.now ?? new Date();
  const uploadExpiresInSeconds = Math.min(
    readPositiveInteger(input.uploadExpiresInSeconds?.toString(), defaultMeetingIntelligenceDirectUploadExpiresInSeconds),
    defaultMeetingIntelligenceDirectUploadExpiresInSeconds
  );
  const expiresAt = new Date(now.getTime() + uploadExpiresInSeconds * 1000).toISOString();
  return partNumbers.map((partNumber) => ({
    expiresAt,
    partNumber,
    upload: {
      headers: { "content-type": metadata.mimeType ?? "application/octet-stream" },
      method: "PUT" as const,
      url: createS3PresignedPutUrl(config, contentObjectKey(ref.key), now, uploadExpiresInSeconds, {
        partNumber: String(partNumber),
        uploadId
      })
    }
  }));
}

export async function completeMeetingIntelligenceMultipartUpload(
  ref: StoredMeetingIntelligenceFileRef,
  input: { parts: MeetingIntelligenceMultipartUploadPart[] },
  options: { now?: Date; env?: MeetingIntelligenceFileStorageEnv } = {}
) {
  const config = getMeetingIntelligenceFileStorageConfig(options.env ?? process.env);
  if (config.backend !== s3MeetingIntelligenceFileStorageBackend || ref.backend !== s3MeetingIntelligenceFileStorageBackend) {
    throw new ApiError(
      "MEETING_INTAKE_MULTIPART_UPLOAD_UNAVAILABLE",
      "Multipart Meeting Intelligence uploads require S3-compatible file storage.",
      422
    );
  }
  const metadata = await readS3MultipartMetadata(config, ref.key);
  validateStoredMetadata(metadata, ref, options.now ?? new Date());
  const uploadId = metadata.multipartUpload?.uploadId;
  const expectedPartCount = metadata.multipartUpload?.partCount;
  if (!uploadId || !expectedPartCount) throw new ApiError("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID", "Multipart upload session is invalid.", 422);
  const parts = normalizeCompletedParts(input.parts, expectedPartCount);
  await completeS3MultipartUpload(config, ref.key, uploadId, parts);
  await putS3Metadata(config, ref);
  const stored = await readStoredMeetingIntelligenceFile(ref, options);
  return stored.ref;
}

export async function abortMeetingIntelligenceMultipartUpload(
  ref: StoredMeetingIntelligenceFileRef,
  options: { env?: MeetingIntelligenceFileStorageEnv } = {}
) {
  const config = getMeetingIntelligenceFileStorageConfig(options.env ?? process.env);
  if (config.backend !== s3MeetingIntelligenceFileStorageBackend || ref.backend !== s3MeetingIntelligenceFileStorageBackend) {
    throw new ApiError(
      "MEETING_INTAKE_MULTIPART_UPLOAD_UNAVAILABLE",
      "Multipart Meeting Intelligence uploads require S3-compatible file storage.",
      422
    );
  }
  const metadata = await readS3MultipartMetadata(config, ref.key);
  const uploadId = metadata.multipartUpload?.uploadId;
  if (uploadId) await abortS3MultipartUpload(config, ref.key, uploadId).catch(() => undefined);
  await deleteS3File(config, ref.key);
  return true;
}

export async function finalizeMeetingIntelligenceDirectUpload(
  ref: StoredMeetingIntelligenceFileRef,
  options: { now?: Date; env?: MeetingIntelligenceFileStorageEnv } = {}
) {
  if (ref.backend !== s3MeetingIntelligenceFileStorageBackend) {
    throw new ApiError(
      "MEETING_INTAKE_DIRECT_UPLOAD_UNAVAILABLE",
      "Direct Meeting Intelligence uploads require S3-compatible file storage.",
      422
    );
  }
  const stored = await readStoredMeetingIntelligenceFile(ref, options);
  return stored.ref;
}

export async function readStoredMeetingIntelligenceFile(
  ref: StoredMeetingIntelligenceFileRef,
  options: { now?: Date; env?: MeetingIntelligenceFileStorageEnv } = {}
) {
  assertStoredFileRef(ref);
  const config = getMeetingIntelligenceFileStorageConfig(options.env ?? process.env);
  if (config.backend !== ref.backend) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file backend does not match configured storage.", 422);
  }
  const metadata =
    ref.backend === s3MeetingIntelligenceFileStorageBackend ? await readS3Metadata(config, ref.key) : await readLocalMetadata(config.local.rootDir, ref.key);
  validateStoredMetadata(metadata, ref, options.now ?? new Date());

  const bytes =
    ref.backend === s3MeetingIntelligenceFileStorageBackend ? await readS3Content(config, ref.key) : await readLocalContent(config.local.rootDir, ref.key);
  verifyStoredBytes(bytes, metadata);
  return { bytes: new Uint8Array(bytes), ref: metadata };
}

export async function deleteStoredMeetingIntelligenceFile(
  ref: Pick<StoredMeetingIntelligenceFileRef, "backend" | "key"> | null | undefined,
  env: MeetingIntelligenceFileStorageEnv = process.env
) {
  if (!ref) return false;
  assertStorageKey(ref.key);
  const config = getMeetingIntelligenceFileStorageConfig(env);
  if (ref.backend !== config.backend) return false;
  if (ref.backend === s3MeetingIntelligenceFileStorageBackend) {
    await deleteS3File(config, ref.key);
    return true;
  }
  if (ref.backend === localMeetingIntelligenceFileStorageBackend) {
    await rm(localStoragePaths(config.local.rootDir, ref.key).dirPath, { force: true, recursive: true });
    return true;
  }
  return false;
}

export async function cleanupExpiredStoredMeetingIntelligenceFiles(
  options: { activeKeys?: Iterable<string>; env?: MeetingIntelligenceFileStorageEnv; now?: Date } = {}
): Promise<CleanupStoredMeetingIntelligenceFilesResult> {
  const config = getMeetingIntelligenceFileStorageConfig(options.env ?? process.env);
  const activeKeys = new Set(options.activeKeys ?? []);
  const now = options.now ?? new Date();
  return config.backend === s3MeetingIntelligenceFileStorageBackend
    ? cleanupExpiredS3Files(config, activeKeys, now)
    : cleanupExpiredLocalFiles(config, activeKeys, now);
}

export function normalizeStoredMeetingIntelligenceFileRef(value: unknown): StoredMeetingIntelligenceFileRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const backend = input.backend;
  const key = readNonEmpty(input.key);
  const byteLength = typeof input.byteLength === "number" && Number.isInteger(input.byteLength) ? input.byteLength : undefined;
  const createdAt = readNonEmpty(input.createdAt);
  const expiresAt = readNonEmpty(input.expiresAt);
  const sha = readNonEmpty(input.sha256);
  const sourceType = input.sourceType;
  const workspaceId = readNonEmpty(input.workspaceId);
  const intakeId = readNonEmpty(input.intakeId);

  if (
    !(backend === localMeetingIntelligenceFileStorageBackend || backend === s3MeetingIntelligenceFileStorageBackend) ||
    !key ||
    !byteLength ||
    byteLength < 1 ||
    !createdAt ||
    !expiresAt ||
    !sha ||
    !(sourceType === "audio" || sourceType === "image" || sourceType === "pdf" || sourceType === "video") ||
    !workspaceId ||
    !intakeId
  ) {
    return null;
  }

  try {
    assertStorageKey(key);
  } catch {
    return null;
  }

  return {
    backend,
    byteLength,
    createdAt,
    expiresAt,
    filename: readNonEmpty(input.filename),
    key,
    mimeType: readNonEmpty(input.mimeType),
    sha256: sha,
    sourceType,
    workspaceId,
    intakeId
  };
}

async function storeLocalFile(config: MeetingIntelligenceFileStorageConfig, ref: StoredMeetingIntelligenceFileRef, bytes: Buffer) {
  const paths = localStoragePaths(config.local.rootDir, ref.key);
  await writeFile(paths.contentPath, bytes, { flag: "wx" }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await ensureStorageDir(paths.dirPath);
    await writeFile(paths.contentPath, bytes, { flag: "wx" });
  });
  await writeFile(paths.metadataPath, `${JSON.stringify(ref, null, 2)}\n`, { flag: "wx" });
}

async function readLocalMetadata(rootDir: string, key: string) {
  return parseStoredMetadata(await readLocalText(localStoragePaths(rootDir, key).metadataPath), key);
}

async function readLocalContent(rootDir: string, key: string) {
  try {
    return await readFile(localStoragePaths(rootDir, key).contentPath);
  } catch {
    throw missingStoredFileError();
  }
}

async function readLocalText(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw missingStoredFileError();
  }
}

async function cleanupExpiredLocalFiles(
  config: MeetingIntelligenceFileStorageConfig,
  activeKeys: Set<string>,
  now: Date
): Promise<CleanupStoredMeetingIntelligenceFilesResult> {
  const metadataPaths = await findLocalMetadataFiles(config.local.rootDir);
  let deleted = 0;
  const failed: CleanupStoredMeetingIntelligenceFilesResult["failed"] = [];
  let skippedActive = 0;

  for (const metadataPath of metadataPaths) {
    let metadata: StoredMeetingIntelligenceFileRef | null = null;
    try {
      metadata = parseStoredMetadata(await readLocalText(metadataPath), undefined, true);
    } catch {
      metadata = null;
    }
    if (!metadata) {
      failed.push({ reason: "metadata_unreadable" });
      continue;
    }
    if (new Date(metadata.expiresAt).getTime() > now.getTime()) continue;
    if (activeKeys.has(metadata.key)) {
      skippedActive += 1;
      continue;
    }
    try {
      await deleteStoredMeetingIntelligenceFile(metadata, { MEETING_INTELLIGENCE_FILE_STORAGE_DIR: config.local.rootDir });
      deleted += 1;
    } catch {
      failed.push({ reason: "delete_failed" });
    }
  }

  return { deleted, failed, scanned: metadataPaths.length, skippedActive };
}

async function storeS3File(config: MeetingIntelligenceFileStorageConfig, ref: StoredMeetingIntelligenceFileRef, bytes: Buffer) {
  await putS3Object(config, contentObjectKey(ref.key), bytes, "application/octet-stream");
  try {
    await putS3Metadata(config, ref);
  } catch (error) {
    await deleteS3File(config, ref.key).catch(() => undefined);
    throw error;
  }
}

async function readS3Metadata(config: MeetingIntelligenceFileStorageConfig, key: string) {
  return parseStoredMetadata(await getS3ObjectText(config, metadataObjectKey(key)), key);
}

async function readS3Content(config: MeetingIntelligenceFileStorageConfig, key: string) {
  return getS3ObjectBytes(config, contentObjectKey(key));
}

async function deleteS3File(config: MeetingIntelligenceFileStorageConfig, key: string) {
  await Promise.all([
    s3Request(config, { method: "DELETE", objectKey: contentObjectKey(key) }),
    s3Request(config, { method: "DELETE", objectKey: metadataObjectKey(key) })
  ]);
}

async function createS3MultipartUpload(config: MeetingIntelligenceFileStorageConfig, ref: StoredMeetingIntelligenceFileRef, contentType: string) {
  const response = await s3Request(config, {
    contentType,
    method: "POST",
    objectKey: contentObjectKey(ref.key),
    query: { uploads: "" }
  });
  if (!response.ok) throw storageUnavailableError();
  const uploadId = readXmlTag(await response.text(), "UploadId");
  if (!uploadId) throw storageUnavailableError();
  return uploadId;
}

async function completeS3MultipartUpload(
  config: MeetingIntelligenceFileStorageConfig,
  key: string,
  uploadId: string,
  parts: MeetingIntelligenceMultipartUploadPart[]
) {
  const body = Buffer.from(
    [
      "<CompleteMultipartUpload>",
      ...parts.map((part) => [
        "<Part>",
        `<PartNumber>${part.partNumber}</PartNumber>`,
        `<ETag>${xmlEncode(part.etag)}</ETag>`,
        "</Part>"
      ].join("")),
      "</CompleteMultipartUpload>"
    ].join(""),
    "utf8"
  );
  const response = await s3Request(config, {
    body,
    contentType: "application/xml",
    method: "POST",
    objectKey: contentObjectKey(key),
    query: { uploadId }
  });
  if (!response.ok) throw storageUnavailableError();
}

async function abortS3MultipartUpload(config: MeetingIntelligenceFileStorageConfig, key: string, uploadId: string) {
  const response = await s3Request(config, {
    method: "DELETE",
    objectKey: contentObjectKey(key),
    query: { uploadId }
  });
  if (!response.ok && response.status !== 404) throw storageUnavailableError();
}

async function cleanupExpiredS3Files(
  config: MeetingIntelligenceFileStorageConfig,
  activeKeys: Set<string>,
  now: Date
): Promise<CleanupStoredMeetingIntelligenceFilesResult> {
  const metadataKeys = await listS3MetadataObjectKeys(config);
  let deleted = 0;
  const failed: CleanupStoredMeetingIntelligenceFilesResult["failed"] = [];
  let skippedActive = 0;

  for (const metadataKey of metadataKeys) {
    const metadata = await getS3ObjectText(config, metadataKey).then((text) => parseStoredMultipartMetadata(text, undefined, true)).catch(() => null);
    if (!metadata) {
      failed.push({ reason: "metadata_unreadable" });
      continue;
    }
    if (new Date(metadata.expiresAt).getTime() > now.getTime()) continue;
    if (activeKeys.has(metadata.key)) {
      skippedActive += 1;
      continue;
    }
    try {
      const uploadId = metadata.multipartUpload?.uploadId;
      if (uploadId) await abortS3MultipartUpload(config, metadata.key, uploadId).catch(() => undefined);
      await deleteS3File(config, metadata.key);
      deleted += 1;
    } catch {
      failed.push({ reason: "delete_failed" });
    }
  }

  return { deleted, failed, scanned: metadataKeys.length, skippedActive };
}

async function putS3Object(config: MeetingIntelligenceFileStorageConfig, objectKey: string, bytes: Buffer, contentType: string) {
  const response = await s3Request(config, { body: bytes, contentType, method: "PUT", objectKey });
  if (!response.ok) throw storageUnavailableError();
}

async function putS3Metadata(config: MeetingIntelligenceFileStorageConfig, ref: StoredMeetingIntelligenceFileRef) {
  const metadataBody = Buffer.from(`${JSON.stringify(ref, null, 2)}\n`, "utf8");
  await putS3Object(config, metadataObjectKey(ref.key), metadataBody, "application/json");
}

async function putS3MultipartMetadata(
  config: MeetingIntelligenceFileStorageConfig,
  ref: StoredMeetingIntelligenceFileRef,
  multipartUpload: NonNullable<StoredMeetingIntelligenceMultipartMetadata["multipartUpload"]>
) {
  const metadataBody = Buffer.from(`${JSON.stringify({ ...ref, multipartUpload }, null, 2)}\n`, "utf8");
  await putS3Object(config, metadataObjectKey(ref.key), metadataBody, "application/json");
}

async function getS3ObjectBytes(config: MeetingIntelligenceFileStorageConfig, objectKey: string) {
  const response = await s3Request(config, { method: "GET", objectKey });
  if (response.status === 404) throw missingStoredFileError();
  if (!response.ok) throw storageUnavailableError();
  return Buffer.from(await response.arrayBuffer());
}

async function getS3ObjectText(config: MeetingIntelligenceFileStorageConfig, objectKey: string) {
  return (await getS3ObjectBytes(config, objectKey)).toString("utf8");
}

async function listS3MetadataObjectKeys(config: MeetingIntelligenceFileStorageConfig) {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const query: Record<string, string | undefined> = {
      "continuation-token": continuationToken,
      "list-type": "2",
      prefix: "workspaces/"
    };
    const response = await s3Request(config, { method: "GET", query });
    if (!response.ok) throw storageUnavailableError();
    const list = parseS3ListObjectsResponse(await response.text());
    keys.push(...list.keys.filter((key) => key.endsWith("/metadata.json")));
    continuationToken = list.nextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function s3Request(config: MeetingIntelligenceFileStorageConfig, input: S3RequestInput) {
  const s3 = requireS3Config(config);
  const now = new Date();
  const body = input.body ?? Buffer.alloc(0);
  const bodyHash = sha256(body);
  const url = s3ObjectUrl(s3, input.objectKey, input.query);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate(now)
  };
  if (input.contentType) headers["content-type"] = input.contentType;
  headers.authorization = s3AuthorizationHeader(s3, input.method, url, headers, bodyHash, now);

  return fetch(url, {
    body: input.method === "PUT" || input.method === "POST" ? new Uint8Array(body) : undefined,
    headers,
    method: input.method
  });
}

function createS3PresignedPutUrl(
  config: MeetingIntelligenceFileStorageConfig,
  objectKey: string,
  now: Date,
  expiresInSeconds: number,
  query: Record<string, string | undefined> = {}
) {
  const s3 = requireS3Config(config);
  const date = amzShortDate(now);
  const credentialScope = `${date}/${s3.region}/s3/aws4_request`;
  const url = s3ObjectUrl(s3, objectKey, query);
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${s3.accessKeyId}/${credentialScope}`);
  url.searchParams.set("X-Amz-Date", amzDate(now));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", "host");

  const canonicalRequest = [
    "PUT",
    url.pathname || "/",
    canonicalQueryString(url),
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate(now),
    credentialScope,
    sha256(Buffer.from(canonicalRequest, "utf8"))
  ].join("\n");
  const signature = hmacHex(s3SigningKey(s3.secretAccessKey, date, s3.region), stringToSign);
  url.searchParams.set("X-Amz-Signature", signature);
  return url.toString();
}

function s3AuthorizationHeader(
  config: S3CompatibleStorageConfig,
  method: string,
  url: URL,
  headers: Record<string, string>,
  payloadHash: string,
  now: Date
) {
  const date = amzShortDate(now);
  const credentialScope = `${date}/${config.region}/s3/aws4_request`;
  const signedHeaders = Object.keys(headers)
    .map((header) => header.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaders.map((header) => `${header}:${headers[header].trim().replace(/\s+/g, " ")}\n`).join("");
  const canonicalRequest = [
    method,
    url.pathname || "/",
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate(now),
    credentialScope,
    sha256(Buffer.from(canonicalRequest, "utf8"))
  ].join("\n");
  const signingKey = s3SigningKey(config.secretAccessKey, date, config.region);
  const signature = hmacHex(signingKey, stringToSign);
  return `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;
}

function s3SigningKey(secretAccessKey: string, date: string, region: string) {
  const kDate = hmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function s3ObjectUrl(config: S3CompatibleStorageConfig, objectKey?: string, query: Record<string, string | undefined> = {}) {
  const endpoint = new URL(config.endpoint);
  const encodedKey = objectKey ? objectKey.split("/").map(amzEncode).join("/") : "";
  const endpointPath = endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/+$/, "");
  const url = config.forcePathStyle
    ? new URL(`${endpoint.origin}${endpointPath}/${amzEncode(config.bucket)}${encodedKey ? `/${encodedKey}` : ""}`)
    : new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}${endpointPath}${encodedKey ? `/${encodedKey}` : "/"}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url;
}

function canonicalQueryString(url: URL) {
  return Array.from(url.searchParams.entries())
    .sort(([aKey, aValue], [bKey, bValue]) => (aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)))
    .map(([key, value]) => `${amzEncode(key)}=${amzEncode(value)}`)
    .join("&");
}

function parseS3ListObjectsResponse(xml: string) {
  return {
    keys: Array.from(xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g), (match) => xmlDecode(match[1] ?? "")),
    nextContinuationToken: readXmlTag(xml, "NextContinuationToken"),
    truncated: readXmlTag(xml, "IsTruncated") === "true"
  };
}

function parseStoredMetadata(text: string, key?: string, allowInvalid = false) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (allowInvalid) throw new Error("metadata_unreadable");
    throw missingStoredFileError();
  }
  const ref = normalizeStoredMeetingIntelligenceFileRef(parsed);
  if (!ref || (key && ref.key !== key)) {
    if (allowInvalid) throw new Error("metadata_invalid");
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  return ref;
}

async function readS3MultipartMetadata(config: MeetingIntelligenceFileStorageConfig, key: string) {
  return parseStoredMultipartMetadata(await getS3ObjectText(config, metadataObjectKey(key)), key);
}

function parseStoredMultipartMetadata(text: string, key?: string, allowInvalid = false): StoredMeetingIntelligenceMultipartMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (allowInvalid) throw new Error("metadata_unreadable");
    throw missingStoredFileError();
  }
  const ref = normalizeStoredMeetingIntelligenceFileRef(parsed);
  const multipartUpload = normalizeMultipartMetadata(
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).multipartUpload
      : undefined
  );
  if (!ref || (key && ref.key !== key)) {
    if (allowInvalid) throw new Error("metadata_invalid");
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  return multipartUpload ? { ...ref, multipartUpload } : ref;
}

function normalizeMultipartMetadata(value: unknown): StoredMeetingIntelligenceMultipartMetadata["multipartUpload"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const uploadId = readNonEmpty(input.uploadId);
  const partSizeBytes = integerInput(input.partSizeBytes);
  const partCount = integerInput(input.partCount);
  const maxParts = integerInput(input.maxParts);
  if (!uploadId || !partSizeBytes || !partCount || !maxParts || input.status !== "awaiting_parts") return undefined;
  return { maxParts, partCount, partSizeBytes, status: "awaiting_parts", uploadId };
}

function buildStoredFileRef(
  config: MeetingIntelligenceFileStorageConfig,
  input: Omit<CreateMeetingIntelligenceDirectUploadInput, "uploadExpiresInSeconds"> & { now: Date }
): StoredMeetingIntelligenceFileRef {
  return {
    backend: config.backend,
    byteLength: input.byteLength,
    createdAt: input.now.toISOString(),
    expiresAt: addDays(input.now, config.retentionDays).toISOString(),
    ...(input.filename ? { filename: input.filename } : {}),
    key: storageKey(input.workspaceId, input.intakeId, randomUUID()),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    sha256: input.sha256.toLowerCase(),
    sourceType: input.sourceType,
    workspaceId: input.workspaceId,
    intakeId: input.intakeId
  };
}

function validateStoredMetadata(metadata: StoredMeetingIntelligenceFileRef, ref: StoredMeetingIntelligenceFileRef, now: Date) {
  if (metadata.backend !== ref.backend || metadata.workspaceId !== ref.workspaceId || metadata.intakeId !== ref.intakeId || metadata.sourceType !== ref.sourceType) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  if (new Date(metadata.expiresAt).getTime() <= now.getTime()) {
    throw new ApiError(
      "MEETING_INTAKE_STORED_FILE_EXPIRED",
      "Stored meeting file is missing or expired. Upload the meeting artifact again.",
      410
    );
  }
}

function verifyStoredBytes(bytes: Buffer, metadata: StoredMeetingIntelligenceFileRef) {
  if (bytes.byteLength !== metadata.byteLength || sha256(bytes) !== metadata.sha256) {
    throw new ApiError(
      "MEETING_INTAKE_STORED_FILE_INVALID",
      "Stored meeting file failed integrity verification. Upload the meeting artifact again.",
      422
    );
  }
}

function assertStoredFileRef(ref: StoredMeetingIntelligenceFileRef) {
  if (!normalizeStoredMeetingIntelligenceFileRef(ref)) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
}

function assertStorageByteLength(byteLength: number, maxBytes: number, sourceType: MediaExtractionKind) {
  if (!Number.isInteger(byteLength) || byteLength < 1) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${sourceType.toUpperCase()} file content was empty.`, 422);
  }
  if (byteLength > maxBytes) {
    throw new ApiError(
      "MEETING_INTAKE_FILE_TOO_LARGE",
      `Provider-backed Meeting Intelligence files are limited to ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
      422
    );
  }
}

function assertSha256(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file checksum is invalid.", 422);
  }
}

function normalizeMultipartPartSize(value: unknown) {
  const parsed = integerInput(value) ?? defaultMeetingIntelligenceMultipartUploadPartSizeBytes;
  return Math.max(parsed, defaultMeetingIntelligenceMultipartUploadPartSizeBytes);
}

function normalizePartNumbers(value: unknown, partCount: number) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID", "Multipart upload part numbers are required.", 422);
  }
  const unique = Array.from(new Set(value.map(integerInput).filter((item): item is number => Boolean(item)))).sort((a, b) => a - b);
  if (unique.length !== value.length || unique.some((partNumber) => partNumber < 1 || partNumber > partCount)) {
    throw new ApiError("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID", "Multipart upload part numbers are invalid.", 422);
  }
  return unique;
}

function normalizeCompletedParts(value: unknown, expectedPartCount: number): MeetingIntelligenceMultipartUploadPart[] {
  if (!Array.isArray(value) || value.length !== expectedPartCount) {
    throw new ApiError("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID", "All multipart upload parts are required before completion.", 422);
  }
  const parts = value.map((item) => {
    const input = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return {
      etag: normalizeEtag(input.etag),
      partNumber: integerInput(input.partNumber)
    };
  });
  if (parts.some((part) => !part.etag || !part.partNumber)) {
    throw new ApiError("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID", "Multipart upload part metadata is invalid.", 422);
  }
  const sorted = parts
    .map((part) => ({ etag: part.etag as string, partNumber: part.partNumber as number }))
    .sort((a, b) => a.partNumber - b.partNumber);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index]?.partNumber !== index + 1) {
      throw new ApiError("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID", "Multipart upload parts must be consecutive.", 422);
    }
  }
  return sorted;
}

function normalizeEtag(value: unknown) {
  const text = readNonEmpty(value);
  if (!text || text.length > 200 || /[\r\n<>]/.test(text)) return undefined;
  return text;
}

function integerInput(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

async function findLocalMetadataFiles(rootDir: string) {
  const root = resolve(rootDir);
  const found: string[] = [];

  async function visit(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name === "metadata.json") {
        found.push(fullPath);
      }
    }
  }

  await visit(root);
  return found;
}

async function ensureStorageDir(path: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { recursive: true, mode: 0o700 });
}

function storageKey(workspaceId: string, intakeId: string, id: string) {
  return `workspaces/${safePathSegment(workspaceId)}/intakes/${safePathSegment(intakeId)}/${safePathSegment(id)}`;
}

function contentObjectKey(key: string) {
  assertStorageKey(key);
  return `${key}/content.bin`;
}

function metadataObjectKey(key: string) {
  assertStorageKey(key);
  return `${key}/metadata.json`;
}

function localStoragePaths(rootDir: string, key: string) {
  assertStorageKey(key);
  const root = resolve(rootDir);
  const dirPath = resolve(root, ...key.split("/"));
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!dirPath.startsWith(rootWithSeparator)) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
  return {
    contentPath: join(dirPath, "content.bin"),
    dirPath,
    metadataPath: join(dirPath, "metadata.json")
  };
}

function assertStorageKey(key: string) {
  const parts = key.split("/");
  if (!key || parts.some((part) => !part || part !== safePathSegment(part))) {
    throw new ApiError("MEETING_INTAKE_STORED_FILE_INVALID", "Stored meeting file reference is invalid.", 422);
  }
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
}

function readStorageBackend(value: unknown): MeetingIntelligenceFileStorageBackend {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized || normalized === "local" || normalized === localMeetingIntelligenceFileStorageBackend) {
    return localMeetingIntelligenceFileStorageBackend;
  }
  if (normalized === "s3" || normalized === s3MeetingIntelligenceFileStorageBackend) {
    return s3MeetingIntelligenceFileStorageBackend;
  }
  throw new ApiError(
    "MEETING_INTAKE_STORAGE_NOT_CONFIGURED",
    "Meeting Intelligence file storage backend is not configured correctly.",
    500
  );
}

function readS3Config(env: MeetingIntelligenceFileStorageEnv): S3CompatibleStorageConfig {
  const endpoint = readNonEmpty(env.MEETING_INTELLIGENCE_S3_ENDPOINT);
  const region = readNonEmpty(env.MEETING_INTELLIGENCE_S3_REGION);
  const bucket = readNonEmpty(env.MEETING_INTELLIGENCE_S3_BUCKET);
  const accessKeyId = readNonEmpty(env.MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID);
  const secretAccessKey = readNonEmpty(env.MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY);
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new ApiError(
      "MEETING_INTAKE_STORAGE_NOT_CONFIGURED",
      "Meeting Intelligence S3-compatible file storage is not configured.",
      500
    );
  }
  try {
    const url = new URL(endpoint);
    if (!(url.protocol === "https:" || url.protocol === "http:")) throw new Error("invalid_protocol");
  } catch {
    throw new ApiError(
      "MEETING_INTAKE_STORAGE_NOT_CONFIGURED",
      "Meeting Intelligence S3-compatible file storage endpoint is invalid.",
      500
    );
  }
  return {
    accessKeyId,
    bucket,
    endpoint,
    forcePathStyle: readBoolean(env.MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE, true),
    region,
    secretAccessKey
  };
}

function requireS3Config(config: MeetingIntelligenceFileStorageConfig) {
  if (!config.s3) {
    throw new ApiError("MEETING_INTAKE_STORAGE_NOT_CONFIGURED", "Meeting Intelligence S3-compatible file storage is not configured.", 500);
  }
  return config.s3;
}

function storageUnavailableError() {
  return new ApiError("MEETING_INTAKE_STORAGE_UNAVAILABLE", "Meeting Intelligence file storage is unavailable.", 503);
}

function missingStoredFileError() {
  return new ApiError(
    "MEETING_INTAKE_STORED_FILE_MISSING",
    "Stored meeting file is missing or expired. Upload the meeting artifact again.",
    410
  );
}

function sha256(bytes: Buffer | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hmac(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function readPositiveInteger(value: unknown, fallback: number) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: unknown, fallback: boolean) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function amzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function amzShortDate(date: Date) {
  return amzDate(date).slice(0, 8);
}

function amzEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function readXmlTag(xml: string, tagName: string) {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(xml);
  return match?.[1] ? xmlDecode(match[1]) : undefined;
}

function xmlDecode(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function xmlEncode(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/>/g, "&gt;")
    .replace(/</g, "&lt;");
}
