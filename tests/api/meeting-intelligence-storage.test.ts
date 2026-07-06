import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupExpiredStoredMeetingIntelligenceFiles,
  abortMeetingIntelligenceMultipartUpload,
  completeMeetingIntelligenceMultipartUpload,
  createMeetingIntelligenceDirectUploadTarget,
  createMeetingIntelligenceMultipartUploadPartTargets,
  createMeetingIntelligenceMultipartUploadTarget,
  deleteStoredMeetingIntelligenceFile,
  finalizeMeetingIntelligenceDirectUpload,
  inspectMeetingIntelligenceMultipartUpload,
  readStoredMeetingIntelligenceFile,
  storeMeetingIntelligenceFile
} from "@/lib/meeting-intelligence/file-storage";

let storageDir: string | undefined;

beforeEach(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "northstar-mi-storage-unit-"));
});

afterEach(async () => {
  if (storageDir) await rm(storageDir, { force: true, recursive: true });
  storageDir = undefined;
  vi.unstubAllGlobals();
});

describe("Meeting Intelligence file storage", () => {
  it("stores provider-backed bytes behind a scoped reference and verifies retrieval", async () => {
    const env = storageEnv();
    const ref = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("whiteboard bytes").toString("base64"),
        filename: "whiteboard.png",
        intakeId: "intake_1",
        mimeType: "image/png",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "image",
        workspaceId: "workspace_1"
      },
      env
    );

    expect(ref).toMatchObject({
      backend: "local-filesystem",
      byteLength: 16,
      filename: "whiteboard.png",
      intakeId: "intake_1",
      mimeType: "image/png",
      sourceType: "image",
      workspaceId: "workspace_1"
    });
    expect(ref.key).not.toContain("whiteboard.png");

    const stored = await readStoredMeetingIntelligenceFile(ref, {
      env,
      now: new Date("2030-01-02T00:00:00.000Z")
    });
    expect(Buffer.from(stored.bytes).toString("utf8")).toBe("whiteboard bytes");

    await expect(deleteStoredMeetingIntelligenceFile(ref, env)).resolves.toBe(true);
    await expect(readStoredMeetingIntelligenceFile(ref, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_MISSING",
      status: 410
    });
  });

  it("cleans expired files while skipping active extraction keys", async () => {
    const env = storageEnv({ MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS: "1" });
    const expired = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("expired").toString("base64"),
        intakeId: "intake_expired",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "audio",
        workspaceId: "workspace_1"
      },
      env
    );
    const activeExpired = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("active").toString("base64"),
        intakeId: "intake_active",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "video",
        workspaceId: "workspace_1"
      },
      env
    );
    const fresh = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("fresh").toString("base64"),
        intakeId: "intake_fresh",
        now: new Date("2030-01-03T12:00:00.000Z"),
        sourceType: "pdf",
        workspaceId: "workspace_1"
      },
      env
    );

    await expect(
      cleanupExpiredStoredMeetingIntelligenceFiles({
        activeKeys: [activeExpired.key],
        env,
        now: new Date("2030-01-04T00:00:00.000Z")
      })
    ).resolves.toEqual({
      deleted: 1,
      failed: [],
      scanned: 3,
      skippedActive: 1
    });
    await expect(readStoredMeetingIntelligenceFile(expired, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_MISSING"
    });
    await expect(readStoredMeetingIntelligenceFile(activeExpired, { env, now: new Date("2030-01-01T12:00:00.000Z") })).resolves.toBeTruthy();
    await expect(readStoredMeetingIntelligenceFile(fresh, { env, now: new Date("2030-01-03T12:30:00.000Z") })).resolves.toBeTruthy();
  });

  it("rejects oversized provider-backed files before queueing storage references", async () => {
    await expect(
      storeMeetingIntelligenceFile(
        {
          fileBase64: Buffer.alloc(1024 * 1024 + 1, "x").toString("base64"),
          intakeId: "intake_large",
          sourceType: "audio",
          workspaceId: "workspace_1"
        },
        storageEnv({ MEETING_INTELLIGENCE_FILE_STORAGE_MAX_MB: "1" })
      )
    ).rejects.toMatchObject({
      code: "MEETING_INTAKE_FILE_TOO_LARGE",
      status: 422
    });
  });

  it("detects local stored-file checksum mismatches", async () => {
    const env = storageEnv();
    const ref = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("audio bytes").toString("base64"),
        intakeId: "intake_checksum",
        sourceType: "audio",
        workspaceId: "workspace_1"
      },
      env
    );
    if (!storageDir) throw new Error("Storage dir was not initialized.");
    await writeFile(join(storageDir, ref.key, "content.bin"), "tampered");

    await expect(readStoredMeetingIntelligenceFile(ref, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_INVALID",
      status: 422
    });
  });

  it("stores, reads, deletes, and cleans up through the S3-compatible backend", async () => {
    const s3 = mockS3Storage();
    const env = s3StorageEnv({ MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS: "1" });
    const ref = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("whiteboard bytes").toString("base64"),
        filename: "whiteboard.png",
        intakeId: "intake_s3",
        mimeType: "image/png",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "image",
        workspaceId: "workspace_1"
      },
      env
    );

    expect(ref).toMatchObject({
      backend: "s3-compatible",
      byteLength: Buffer.byteLength("whiteboard bytes"),
      filename: "whiteboard.png",
      sourceType: "image"
    });
    expect(ref.key).not.toContain("whiteboard.png");
    expect(s3.objects.has(`${ref.key}/content.bin`)).toBe(true);
    expect(s3.objects.has(`${ref.key}/metadata.json`)).toBe(true);
    expect(s3.requests.some((request) => request.authorization.startsWith("AWS4-HMAC-SHA256"))).toBe(true);
    expect(JSON.stringify(s3.requests)).not.toContain("test-secret");

    await expect(
      readStoredMeetingIntelligenceFile(ref, {
        env,
        now: new Date("2030-01-01T12:00:00.000Z")
      })
    ).resolves.toMatchObject({
      ref: {
        backend: "s3-compatible",
        key: ref.key,
        workspaceId: "workspace_1"
      }
    });

    const activeExpired = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("active").toString("base64"),
        intakeId: "intake_active",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "video",
        workspaceId: "workspace_1"
      },
      env
    );
    const fresh = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("fresh").toString("base64"),
        intakeId: "intake_fresh",
        now: new Date("2030-01-03T12:00:00.000Z"),
        sourceType: "pdf",
        workspaceId: "workspace_1"
      },
      env
    );

    await expect(
      cleanupExpiredStoredMeetingIntelligenceFiles({
        activeKeys: [activeExpired.key],
        env,
        now: new Date("2030-01-04T00:00:00.000Z")
      })
    ).resolves.toEqual({
      deleted: 1,
      failed: [],
      scanned: 3,
      skippedActive: 1
    });
    expect(s3.objects.has(`${ref.key}/content.bin`)).toBe(false);
    expect(s3.objects.has(`${activeExpired.key}/content.bin`)).toBe(true);
    expect(s3.objects.has(`${fresh.key}/content.bin`)).toBe(true);

    await expect(deleteStoredMeetingIntelligenceFile(activeExpired, env)).resolves.toBe(true);
    await expect(readStoredMeetingIntelligenceFile(activeExpired, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_MISSING",
      status: 410
    });
  });

  it("creates and finalizes S3 direct upload targets without app-handled file bytes", async () => {
    const s3 = mockS3Storage();
    const env = s3StorageEnv();
    const bytes = Buffer.from("direct audio bytes");
    const target = await createMeetingIntelligenceDirectUploadTarget(
      {
        byteLength: bytes.byteLength,
        filename: "direct-call.mp3",
        intakeId: "intake_direct",
        mimeType: "audio/mpeg",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sha256: testSha256(bytes),
        sourceType: "audio",
        uploadExpiresInSeconds: 600,
        workspaceId: "workspace_1"
      },
      env
    );

    expect(target.storedFile).toMatchObject({
      backend: "s3-compatible",
      byteLength: bytes.byteLength,
      filename: "direct-call.mp3",
      intakeId: "intake_direct",
      mimeType: "audio/mpeg",
      sha256: testSha256(bytes),
      sourceType: "audio",
      workspaceId: "workspace_1"
    });
    expect(target.upload).toMatchObject({
      expiresAt: "2030-01-01T00:10:00.000Z",
      headers: { "content-type": "audio/mpeg" },
      method: "PUT"
    });
    const uploadUrl = new URL(target.upload.url);
    expect(uploadUrl.hostname).toBe("s3.example.test");
    expect(uploadUrl.pathname).toContain(`${target.storedFile.key}/content.bin`);
    expect(uploadUrl.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(uploadUrl.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(uploadUrl.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(uploadUrl.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(target.upload.url).not.toContain("test-secret");
    expect(target.upload.url).not.toContain("direct-call.mp3");
    expect(s3.objects.has(`${target.storedFile.key}/metadata.json`)).toBe(true);
    expect(s3.objects.has(`${target.storedFile.key}/content.bin`)).toBe(false);

    s3.objects.set(`${target.storedFile.key}/content.bin`, bytes);
    await expect(
      finalizeMeetingIntelligenceDirectUpload(target.storedFile, {
        env,
        now: new Date("2030-01-01T00:05:00.000Z")
      })
    ).resolves.toMatchObject({ key: target.storedFile.key, sourceType: "audio" });
    const stored = await readStoredMeetingIntelligenceFile(target.storedFile, { env });
    expect(Buffer.from(stored.bytes).toString("utf8")).toBe("direct audio bytes");
  });

  it("rejects direct upload targets on the local backend and invalid upload checksums", async () => {
    const bytes = Buffer.from("direct audio bytes");
    await expect(
      createMeetingIntelligenceDirectUploadTarget(
        {
          byteLength: bytes.byteLength,
          intakeId: "intake_local",
          sha256: testSha256(bytes),
          sourceType: "audio",
          workspaceId: "workspace_1"
        },
        storageEnv()
      )
    ).rejects.toMatchObject({
      code: "MEETING_INTAKE_DIRECT_UPLOAD_UNAVAILABLE",
      status: 422
    });

    await expect(
      createMeetingIntelligenceDirectUploadTarget(
        {
          byteLength: bytes.byteLength,
          intakeId: "intake_checksum",
          sha256: "not-a-checksum",
          sourceType: "audio",
          workspaceId: "workspace_1"
        },
        s3StorageEnv()
      )
    ).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_INVALID",
      status: 422
    });
  });

  it("fails direct upload finalization clearly when content is missing or tampered", async () => {
    const s3 = mockS3Storage();
    const env = s3StorageEnv();
    const bytes = Buffer.from("direct image bytes");
    const target = await createMeetingIntelligenceDirectUploadTarget(
      {
        byteLength: bytes.byteLength,
        intakeId: "intake_missing_direct",
        mimeType: "image/png",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sha256: testSha256(bytes),
        sourceType: "image",
        workspaceId: "workspace_1"
      },
      env
    );

    await expect(finalizeMeetingIntelligenceDirectUpload(target.storedFile, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_MISSING",
      status: 410
    });

    s3.objects.set(`${target.storedFile.key}/content.bin`, Buffer.from("tampered"));
    await expect(finalizeMeetingIntelligenceDirectUpload(target.storedFile, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_INVALID",
      status: 422
    });
  });

  it("creates, signs, completes, and reads S3 multipart uploads without app-handled file bytes", async () => {
    const s3 = mockS3Storage();
    const env = s3StorageEnv({ MEETING_INTELLIGENCE_FILE_STORAGE_MAX_MB: "64" });
    const bytes = Buffer.concat([
      Buffer.alloc(8 * 1024 * 1024, "a"),
      Buffer.alloc(8 * 1024 * 1024, "b"),
      Buffer.from("tail")
    ]);
    const target = await createMeetingIntelligenceMultipartUploadTarget(
      {
        byteLength: bytes.byteLength,
        filename: "long-call.mp3",
        intakeId: "intake_multipart",
        mimeType: "audio/mpeg",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sha256: testSha256(bytes),
        sourceType: "audio",
        workspaceId: "workspace_1"
      },
      env
    );

    expect(target.multipart).toMatchObject({
      abortSupported: true,
      partCount: 3,
      partSizeBytes: 8 * 1024 * 1024
    });
    expect(target.storedFile.key).not.toContain("long-call.mp3");
    expect(s3.objects.has(`${target.storedFile.key}/metadata.json`)).toBe(true);
    expect(s3.objects.has(`${target.storedFile.key}/content.bin`)).toBe(false);

    const signedParts = await createMeetingIntelligenceMultipartUploadPartTargets(
      target.storedFile,
      { partNumbers: [1, 2, 3], uploadExpiresInSeconds: 600 },
      { env, now: new Date("2030-01-01T00:01:00.000Z") }
    );
    expect(signedParts).toHaveLength(3);
    expect(signedParts[0]?.upload.url).toContain("partNumber=1");
    expect(signedParts[0]?.upload.url).toContain("uploadId=");
    expect(signedParts[0]?.upload.url).not.toContain("test-secret");
    expect(signedParts[0]?.upload.url).not.toContain("long-call.mp3");

    const completedParts = [];
    for (const part of signedParts) {
      const start = (part.partNumber - 1) * target.multipart.partSizeBytes;
      const end = Math.min(start + target.multipart.partSizeBytes, bytes.byteLength);
      const response = await fetch(part.upload.url, {
        body: bytes.subarray(start, end),
        headers: part.upload.headers,
        method: part.upload.method
      });
      expect(response.status).toBe(200);
      completedParts.push({ etag: response.headers.get("etag") ?? "", partNumber: part.partNumber });
    }
    await expect(inspectMeetingIntelligenceMultipartUpload(target.storedFile, { env })).resolves.toMatchObject({
      maxParts: 10_000,
      partCount: 3,
      partSizeBytes: 8 * 1024 * 1024,
      parts: completedParts.map((part, index) => ({
        etag: part.etag,
        partNumber: part.partNumber,
        sizeBytes: index === 2 ? Buffer.byteLength("tail") : 8 * 1024 * 1024
      }))
    });

    await expect(
      completeMeetingIntelligenceMultipartUpload(
        target.storedFile,
        { parts: completedParts },
        { env, now: new Date("2030-01-01T00:05:00.000Z") }
      )
    ).resolves.toMatchObject({ key: target.storedFile.key, sourceType: "audio" });
    const stored = await readStoredMeetingIntelligenceFile(target.storedFile, { env });
    expect(Buffer.from(stored.bytes).equals(bytes)).toBe(true);
  });

  it("aborts and cleans expired abandoned S3 multipart upload sessions", async () => {
    const s3 = mockS3Storage();
    const env = s3StorageEnv({ MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS: "1" });
    const bytes = Buffer.alloc(9 * 1024 * 1024, "m");
    const target = await createMeetingIntelligenceMultipartUploadTarget(
      {
        byteLength: bytes.byteLength,
        intakeId: "intake_multipart_abandoned",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sha256: testSha256(bytes),
        sourceType: "video",
        workspaceId: "workspace_1"
      },
      env
    );
    expect(s3.multipartUploads.size).toBe(1);

    await expect(abortMeetingIntelligenceMultipartUpload(target.storedFile, { env })).resolves.toBe(true);
    expect(s3.multipartUploads.size).toBe(0);
    await expect(readStoredMeetingIntelligenceFile(target.storedFile, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_MISSING"
    });

    const abandoned = await createMeetingIntelligenceMultipartUploadTarget(
      {
        byteLength: bytes.byteLength,
        intakeId: "intake_multipart_cleanup",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sha256: testSha256(bytes),
        sourceType: "video",
        workspaceId: "workspace_1"
      },
      env
    );
    expect(s3.multipartUploads.size).toBe(1);
    await expect(
      cleanupExpiredStoredMeetingIntelligenceFiles({
        env,
        now: new Date("2030-01-03T00:00:00.000Z")
      })
    ).resolves.toEqual({
      deleted: 1,
      failed: [],
      scanned: 1,
      skippedActive: 0
    });
    expect(s3.multipartUploads.size).toBe(0);
    expect(s3.objects.has(`${abandoned.storedFile.key}/metadata.json`)).toBe(false);
  });

  it("cleans expired abandoned S3 direct upload sessions without exposing file details", async () => {
    const s3 = mockS3Storage();
    const env = s3StorageEnv({ MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS: "1" });
    const abandoned = await createMeetingIntelligenceDirectUploadTarget(
      {
        byteLength: 12,
        intakeId: "intake_abandoned",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sha256: testSha256(Buffer.from("not-uploaded")),
        sourceType: "video",
        workspaceId: "workspace_1"
      },
      env
    );

    await expect(
      cleanupExpiredStoredMeetingIntelligenceFiles({
        env,
        now: new Date("2030-01-03T00:00:00.000Z")
      })
    ).resolves.toEqual({
      deleted: 1,
      failed: [],
      scanned: 1,
      skippedActive: 0
    });
    expect(s3.objects.has(`${abandoned.storedFile.key}/metadata.json`)).toBe(false);
    expect(s3.objects.has(`${abandoned.storedFile.key}/content.bin`)).toBe(false);
  });

  it("fails S3-compatible reads clearly for missing, tampered, and expired objects", async () => {
    const s3 = mockS3Storage();
    const env = s3StorageEnv({ MEETING_INTELLIGENCE_FILE_STORAGE_RETENTION_DAYS: "1" });
    const missing = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("missing").toString("base64"),
        intakeId: "intake_missing",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "audio",
        workspaceId: "workspace_1"
      },
      env
    );
    s3.objects.delete(`${missing.key}/content.bin`);
    await expect(readStoredMeetingIntelligenceFile(missing, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_MISSING",
      status: 410
    });

    const tampered = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("original").toString("base64"),
        intakeId: "intake_tampered",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "image",
        workspaceId: "workspace_1"
      },
      env
    );
    s3.objects.set(`${tampered.key}/content.bin`, Buffer.from("tampered"));
    await expect(readStoredMeetingIntelligenceFile(tampered, { env })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_INVALID",
      status: 422
    });

    const expired = await storeMeetingIntelligenceFile(
      {
        fileBase64: Buffer.from("expired").toString("base64"),
        intakeId: "intake_expired",
        now: new Date("2030-01-01T00:00:00.000Z"),
        sourceType: "pdf",
        workspaceId: "workspace_1"
      },
      env
    );
    await expect(readStoredMeetingIntelligenceFile(expired, { env, now: new Date("2030-01-03T00:00:00.000Z") })).rejects.toMatchObject({
      code: "MEETING_INTAKE_STORED_FILE_EXPIRED",
      status: 410
    });
  });
});

function storageEnv(overrides: Record<string, string> = {}) {
  if (!storageDir) throw new Error("Storage dir was not initialized.");
  return {
    MEETING_INTELLIGENCE_FILE_STORAGE_DIR: storageDir,
    ...overrides
  };
}

function s3StorageEnv(overrides: Record<string, string> = {}) {
  return {
    MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND: "s3",
    MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID: "test-access",
    MEETING_INTELLIGENCE_S3_BUCKET: "northstar-mi-test",
    MEETING_INTELLIGENCE_S3_ENDPOINT: "https://s3.example.test",
    MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE: "true",
    MEETING_INTELLIGENCE_S3_REGION: "auto",
    MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY: "test-secret",
    ...overrides
  };
}

type MockS3Storage = {
  multipartUploads: Map<string, { key: string; parts: Map<number, Buffer> }>;
  objects: Map<string, Buffer>;
  requests: Array<{ authorization: string; method: string; url: string }>;
};

function mockS3Storage(): MockS3Storage {
  const objects = new Map<string, Buffer>();
  const multipartUploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const requests: Array<{ authorization: string; method: string; url: string }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const presigned = url.searchParams.has("X-Amz-Signature");
    requests.push({ authorization: headers.get("authorization") ?? "", method, url: url.toString() });
    expect(url.hostname).toBe("s3.example.test");
    expect(url.pathname.startsWith("/northstar-mi-test")).toBe(true);
    if (presigned) {
      expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
      expect(url.toString()).not.toContain("test-secret");
    } else {
      expect(headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
      expect(headers.get("authorization")).not.toContain("test-secret");
    }

    if (url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = Array.from(objects.keys()).filter((key) => key.startsWith(prefix));
      return new Response(
        [
          "<ListBucketResult>",
          "<IsTruncated>false</IsTruncated>",
          ...keys.map((key) => `<Contents><Key>${xmlEscape(key)}</Key></Contents>`),
          "</ListBucketResult>"
        ].join(""),
        { status: 200 }
      );
    }

    const key = decodeURIComponent(url.pathname.replace(/^\/northstar-mi-test\/?/, ""));
    if (method === "POST" && url.searchParams.has("uploads")) {
      const uploadId = `upload-${multipartUploads.size + 1}`;
      multipartUploads.set(uploadId, { key, parts: new Map() });
      return new Response(`<InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`, { status: 200 });
    }
    if (method === "POST" && url.searchParams.has("uploadId")) {
      const uploadId = url.searchParams.get("uploadId") ?? "";
      const upload = multipartUploads.get(uploadId);
      if (!upload) return new Response(null, { status: 404 });
      const xml = await new Response(init?.body as BodyInit).text();
      const partNumbers = Array.from(xml.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g), (match) => Number(match[1]));
      objects.set(upload.key, Buffer.concat(partNumbers.map((partNumber) => upload.parts.get(partNumber) ?? Buffer.alloc(0))));
      multipartUploads.delete(uploadId);
      return new Response("<CompleteMultipartUploadResult />", { status: 200 });
    }
    if (method === "GET" && url.searchParams.has("uploadId")) {
      const uploadId = url.searchParams.get("uploadId") ?? "";
      const upload = multipartUploads.get(uploadId);
      if (!upload) return new Response(null, { status: 404 });
      return new Response(
        [
          "<ListPartsResult>",
          "<IsTruncated>false</IsTruncated>",
          ...Array.from(upload.parts.entries()).map(([partNumber, body]) => [
            "<Part>",
            `<PartNumber>${partNumber}</PartNumber>`,
            `<ETag>${xmlEscape(`"part-${partNumber}-${body.byteLength}"`)}</ETag>`,
            `<Size>${body.byteLength}</Size>`,
            "</Part>"
          ].join("")),
          "</ListPartsResult>"
        ].join(""),
        { status: 200 }
      );
    }
    if (method === "PUT") {
      const uploadId = url.searchParams.get("uploadId");
      const partNumber = Number(url.searchParams.get("partNumber"));
      if (uploadId && partNumber) {
        const upload = multipartUploads.get(uploadId);
        if (!upload) return new Response(null, { status: 404 });
        const body = Buffer.from(await new Response(init?.body as BodyInit).arrayBuffer());
        upload.parts.set(partNumber, body);
        return new Response(null, { status: 200, headers: { etag: `"part-${partNumber}-${body.byteLength}"` } });
      }
      objects.set(key, Buffer.from(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (method === "GET") {
      const body = objects.get(key);
      return body
        ? new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { status: 200 })
        : new Response(null, { status: 404 });
    }
    if (method === "DELETE") {
      const uploadId = url.searchParams.get("uploadId");
      if (uploadId) {
        multipartUploads.delete(uploadId);
        return new Response(null, { status: 204 });
      }
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  });
  return { multipartUploads, objects, requests };
}

function testSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
