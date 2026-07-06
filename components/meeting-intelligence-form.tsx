"use client";

import { FileText, ShieldCheck, UploadCloud, Wand2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Badge } from "@/components/badge";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { meetingDirectUploadSourceType } from "@/lib/meeting-intelligence/direct-upload-eligibility";
import { detectMeetingSource } from "@/lib/meeting-intelligence/source-detection";

type Option = { id: string; label: string };

type MeetingIntelligenceFormProps = {
  options: {
    deals: Option[];
    leads: Option[];
    organizations: Option[];
    people: Option[];
  };
  workspaceId: string;
};

export function MeetingIntelligenceForm({ options, workspaceId }: MeetingIntelligenceFormProps) {
  const router = useRouter();
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileMime, setFileMime] = useState("");
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadCapabilities, setUploadCapabilities] = useState<MeetingUploadCapabilities | null>(null);
  const [multipartResumeState, setMultipartResumeState] = useState<MultipartResumeState | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetch(`/api/v1/workspaces/${workspaceId}/meeting-intake-upload-capabilities`)
      .then((response) => response.ok ? response.json() : null)
      .then((capabilities: MeetingUploadCapabilities | null) => {
        if (isMounted) setUploadCapabilities(capabilities);
      })
      .catch(() => {
        if (isMounted) setUploadCapabilities(null);
      });
    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    let isMounted = true;
    const localState = readMultipartResumeState(workspaceId);
    if (!localState) return;
    if (multipartResumeStateIsExpired(localState)) {
      clearMultipartResumeState(workspaceId);
      setUploadStatus("Previous multipart upload expired. Choose the file again to start a new upload.");
      return;
    }
    inspectMultipartResumeState(workspaceId, localState)
      .then((inspected) => {
        if (!isMounted) return;
        if (inspected.status === "queued") {
          clearMultipartResumeState(workspaceId);
          setMultipartResumeState(null);
          setUploadStatus("Previous multipart upload is already queued for extraction.");
          return;
        }
        if (inspected.status === "awaiting_parts" && inspected.resumeAllowed) {
          const merged = mergeMultipartResumeState(localState, inspected);
          persistMultipartResumeState(merged);
          setMultipartResumeState(merged);
        }
      })
      .catch(() => {
        clearMultipartResumeState(workspaceId);
        if (isMounted) {
          setMultipartResumeState(null);
          setUploadStatus("Previous multipart upload can no longer be resumed.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  async function onFileChange(file: File | undefined) {
    setFileText("");
    setFileName(file?.name ?? "");
    setFileMime(file?.type ?? "");
    setFileNotice(null);
    setSelectedFile(file ?? null);
    setUploadStatus(null);
    if (!file) return;
    const lower = file.name.toLowerCase();
    const setNotice = (message: string) => setFileNotice(capabilityAwareFileNotice(message, file, uploadCapabilities));
    if (
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".rtf") ||
      lower.endsWith(".html") ||
      lower.endsWith(".htm") ||
      lower.endsWith(".csv") ||
      lower.endsWith(".json") ||
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.type === "application/rtf"
    ) {
      setFileText(await file.text());
      setNotice("Text, RTF, HTML, CSV, JSON, and markdown files extract locally before review.");
      return;
    }
    if (lower.endsWith(".pdf") || file.type === "application/pdf") {
      setNotice("Text-based PDFs extract locally. Scanned PDFs queue OCR/vision extraction when a PDF-capable provider is configured.");
      return;
    }
    if (
      lower.endsWith(".docx") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      setNotice("DOCX files extract locally before review.");
      return;
    }
    if (lower.endsWith(".doc") || file.type === "application/msword") {
      setNotice("Legacy .doc files are not supported. Convert the document to .docx before intake.");
      return;
    }
    if (
      lower.endsWith(".pptx") ||
      file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      setNotice("PPTX decks are not locally parsed yet. Export to PDF, DOCX, markdown, HTML, or text before intake.");
      return;
    }
    if (lower.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      setNotice("XLSX workbooks are not locally parsed yet. Export to CSV, markdown, HTML, or text before intake.");
      return;
    }
    if (file.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(file.name)) {
      setNotice("Images and whiteboards queue OCR/vision extraction when a provider is configured; otherwise the intake explains the missing provider.");
      return;
    }
    if (file.type.startsWith("audio/") || /\.(m4a|mp3|wav)$/i.test(file.name)) {
      setNotice("Audio recordings queue transcription when a provider is configured; otherwise the intake explains the missing provider.");
      return;
    }
    if (file.type.startsWith("video/") || /\.(mov|mp4|webm)$/i.test(file.name)) {
      setNotice("Video recordings queue transcription/media extraction when a provider is configured; otherwise the intake explains the missing provider.");
      return;
    }
    setNotice("This file type is not supported yet and will fail with a clear processor requirement.");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const text = String(formData.get("text") ?? "");
    const contextText = String(formData.get("contextText") ?? "");
    if (!text.trim() && !fileName) {
      setError("Paste notes or choose a meeting artifact first.");
      return;
    }
    const sourceType = String(formData.get("sourceType") ?? "");
    const hints = {
      dealId: String(formData.get("dealId") ?? ""),
      leadId: String(formData.get("leadId") ?? ""),
      organizationId: String(formData.get("organizationId") ?? ""),
      personIds: formData.getAll("personIds").map(String)
    };
    const fileGate = selectedFile ? uploadGateForFile(selectedFile, sourceType, uploadCapabilities) : { allowed: true as const };
    if (!fileGate.allowed) {
      setError(fileGate.message);
      return;
    }
    setIsSaving(true);
    setUploadStatus(null);
    const directUploadResult = selectedFile
      ? await tryDirectUploadIntake(selectedFile, {
          contextText,
          hints,
          sourceType
        }).catch((directUploadError) => {
          setError(formatDirectUploadError(directUploadError));
          return "failed" as const;
        })
      : false;

    if (directUploadResult === "failed") {
      setIsSaving(false);
      return;
    }
    if (directUploadResult) return;

    if (selectedFile && !fileText) {
      setUploadStatus("Preparing standard upload...");
    }
    const fallbackFileBase64 = selectedFile && !fileText && shouldReadFileForFallback(selectedFile)
      ? arrayBufferToBase64(await selectedFile.arrayBuffer())
      : "";
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/meeting-intakes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextText,
        explicitSourceType: sourceType,
        fileBase64: fallbackFileBase64,
        fileText,
        hints,
        originalFilename: fileName,
        originalMimeType: fileMime,
        text
      })
    });

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.id) {
      setError(body?.error?.message ?? "Could not create the meeting intake.");
      setIsSaving(false);
      setUploadStatus(null);
      return;
    }
    setUploadStatus("Intake queued for analysis.");
    router.push(`/meeting-intelligence/${body.id}` as Route);
    router.refresh();
  }

  async function tryDirectUploadIntake(
    file: File,
    input: {
      contextText: string;
      hints: {
        dealId: string;
        leadId: string;
        organizationId: string;
        personIds: string[];
      };
      sourceType: string;
    }
  ) {
    const directSourceType = meetingDirectUploadSourceType({
      byteLength: file.size,
      explicitSourceType: input.sourceType,
      filename: file.name,
      mimeType: file.type
    });
    if (!directSourceType) return false;
    const directDecision = directUploadDecision(file, directSourceType, uploadCapabilities);
    if (directDecision.action === "block") throw new Error(directDecision.message);
    if (directDecision.action === "multipart") return uploadMultipartIntake(file, input, directSourceType);
    if (directDecision.action === "fallback") {
      setUploadStatus(directDecision.message);
      return false;
    }

    setUploadStatus("Hashing file...");
    const sha256 = await fileSha256(file);
    setUploadStatus("Requesting direct upload session...");
    const sessionResponse = await fetch(`/api/v1/workspaces/${workspaceId}/meeting-intake-upload-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        byteLength: file.size,
        explicitSourceType: directSourceType,
        originalFilename: file.name,
        originalMimeType: file.type,
        sha256
      })
    });
    const session = await sessionResponse.json().catch(() => null) as DirectUploadSessionResponse | null;
    if (!sessionResponse.ok || !session?.uploadSessionId || !session.upload?.url) {
      if (isDirectUploadFallbackError(session)) {
        setUploadStatus("Direct upload unavailable; using standard upload.");
        return false;
      }
      throw new Error(directUploadErrorMessage(session?.error, "Could not create a direct upload session."));
    }

    setUploadStatus("Uploading file directly...");
    const uploadResponse = await uploadWithRetry(session.upload, file);
    if (!uploadResponse.ok) {
      throw new Error("Direct upload failed. Try again before the upload session expires.");
    }

    setUploadStatus("Finalizing upload...");
    const finalizeResponse = await fetch(
      `/api/v1/workspaces/${workspaceId}/meeting-intake-upload-sessions/${session.uploadSessionId}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          byteLength: file.size,
          contextText: input.contextText,
          explicitSourceType: directSourceType,
          hints: input.hints,
          originalFilename: file.name,
          originalMimeType: file.type,
          sha256
        })
      }
    );
    const finalized = await finalizeResponse.json().catch(() => null) as DirectUploadFinalizeResponse | null;
    if (finalizeResponse.status === 409 && finalized?.error?.code === "MEETING_INTAKE_DIRECT_UPLOAD_INVALID_STATE") {
      setUploadStatus("Upload already finalized; opening intake...");
      router.push(`/meeting-intelligence/${session.uploadSessionId}` as Route);
      router.refresh();
      return true;
    }
    if (!finalizeResponse.ok || !finalized?.id) {
      throw new Error(directUploadErrorMessage(finalized?.error, "Could not finalize the uploaded meeting artifact."));
    }
    setUploadStatus("Queued for extraction.");
    router.push(`/meeting-intelligence/${finalized.id}` as Route);
    router.refresh();
    return true;
  }

  async function uploadMultipartIntake(
    file: File,
    input: {
      contextText: string;
      hints: {
        dealId: string;
        leadId: string;
        organizationId: string;
        personIds: string[];
      };
      sourceType: string;
    },
    directSourceType: "audio" | "image" | "pdf" | "video"
  ) {
    setUploadStatus("Hashing file...");
    const sha256 = await fileSha256(file);
    setUploadStatus("Creating multipart upload session...");
    const sessionResponse = await fetch(`/api/v1/workspaces/${workspaceId}/meeting-intake-multipart-upload-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        byteLength: file.size,
        explicitSourceType: directSourceType,
        originalFilename: file.name,
        originalMimeType: file.type,
        sha256
      })
    });
    const session = await sessionResponse.json().catch(() => null) as MultipartUploadSessionResponse | null;
    if (!sessionResponse.ok || !session?.uploadSessionId || !session.multipart?.partCount || !session.multipart.partSizeBytes || !session.multipart.expiresAt) {
      throw new Error(directUploadErrorMessage(session?.error, "Could not create a multipart upload session."));
    }

    const resumeState: MultipartResumeState = {
      byteLength: file.size,
      createdAt: new Date().toISOString(),
      expiresAt: session.multipart.expiresAt,
      fileLabel: file.name || `${directSourceType.toUpperCase()} upload`,
      originalFilename: file.name,
      originalMimeType: file.type,
      partCount: session.multipart.partCount,
      partSizeBytes: session.multipart.partSizeBytes,
      sha256,
      sourceType: directSourceType,
      uploadedParts: [],
      uploadSessionId: session.uploadSessionId,
      workspaceId
    };
    persistMultipartResumeState(resumeState);
    setMultipartResumeState(resumeState);
    return continueMultipartUpload(file, input, resumeState);
  }

  async function continueMultipartUpload(
    file: File,
    input: {
      contextText: string;
      hints: {
        dealId: string;
        leadId: string;
        organizationId: string;
        personIds: string[];
      };
      sourceType: string;
    },
    resumeState: MultipartResumeState
  ) {
    const completedParts = new Map(resumeState.uploadedParts.map((part) => [part.partNumber, part]));
    for (let partNumber = 1; partNumber <= resumeState.partCount; partNumber += 1) {
      if (completedParts.has(partNumber)) continue;
      const partsResponse = await fetch(
        `/api/v1/workspaces/${workspaceId}/meeting-intake-multipart-upload-sessions/${resumeState.uploadSessionId}/parts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partNumbers: [partNumber] })
        }
      );
      const signedParts = await partsResponse.json().catch(() => null) as MultipartUploadPartsResponse | null;
      const part = signedParts?.parts?.[0];
      if (!partsResponse.ok || !part || part.partNumber !== partNumber) {
        throw new Error(directUploadErrorMessage(signedParts?.error, "Could not prepare multipart upload parts."));
      }

      const start = (partNumber - 1) * resumeState.partSizeBytes;
      const end = Math.min(start + resumeState.partSizeBytes, file.size);
      setUploadStatus(`Uploading part ${partNumber} of ${resumeState.partCount}...`);
      const response = await fetch(part.upload.url, {
        body: file.slice(start, end),
        headers: part.upload.headers,
        method: part.upload.method
      });
      if (!response.ok) throw new Error(`Multipart upload failed on part ${partNumber}.`);
      const etag = response.headers.get("etag") ?? response.headers.get("ETag");
      if (!etag) throw new Error("Multipart upload part response did not include an ETag.");
      completedParts.set(partNumber, { etag, partNumber });
      const updatedState = {
        ...resumeState,
        uploadedParts: Array.from(completedParts.values()).sort((a, b) => a.partNumber - b.partNumber)
      };
      persistMultipartResumeState(updatedState);
      setMultipartResumeState(updatedState);
    }

    const parts = Array.from(completedParts.values()).sort((a, b) => a.partNumber - b.partNumber);
    setUploadStatus("Completing multipart upload...");
    const completeResponse = await fetch(
      `/api/v1/workspaces/${workspaceId}/meeting-intake-multipart-upload-sessions/${resumeState.uploadSessionId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          byteLength: file.size,
          contextText: input.contextText,
          explicitSourceType: resumeState.sourceType,
          hints: input.hints,
          originalFilename: file.name,
          originalMimeType: file.type,
          parts,
          sha256: resumeState.sha256
        })
      }
    );
    const completed = await completeResponse.json().catch(() => null) as DirectUploadFinalizeResponse | null;
    if (completeResponse.status === 409 && completed?.error?.code === "MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE") {
      clearMultipartResumeState(workspaceId);
      setMultipartResumeState(null);
      setUploadStatus("Upload already finalized; opening intake...");
      router.push(`/meeting-intelligence/${resumeState.uploadSessionId}` as Route);
      router.refresh();
      return true;
    }
    if (!completeResponse.ok || !completed?.id) {
      throw new Error(directUploadErrorMessage(completed?.error, "Could not complete the multipart upload."));
    }
    clearMultipartResumeState(workspaceId);
    setMultipartResumeState(null);
    setUploadStatus("Queued for extraction.");
    router.push(`/meeting-intelligence/${completed.id}` as Route);
    router.refresh();
    return true;
  }

  async function onResumeMultipartUpload(form: HTMLFormElement | null) {
    if (!multipartResumeState) return;
    setError(null);
    if (!selectedFile) {
      setError("Choose the same file to resume the interrupted multipart upload.");
      return;
    }
    if (selectedFile.size !== multipartResumeState.byteLength) {
      setError("The selected file size does not match the interrupted multipart upload.");
      return;
    }
    setIsSaving(true);
    try {
      setUploadStatus("Verifying selected file...");
      const sha256 = await fileSha256(selectedFile);
      if (sha256 !== multipartResumeState.sha256) {
        throw new Error("The selected file checksum does not match the interrupted multipart upload.");
      }
      const inspected = await inspectMultipartResumeState(workspaceId, multipartResumeState);
      if (inspected.status === "queued") {
        clearMultipartResumeState(workspaceId);
        setMultipartResumeState(null);
        setUploadStatus("Previous multipart upload is already queued for extraction.");
        setIsSaving(false);
        return;
      }
      const merged = mergeMultipartResumeState(multipartResumeState, inspected);
      persistMultipartResumeState(merged);
      setMultipartResumeState(merged);
      await continueMultipartUpload(selectedFile, formInputFromForm(form), merged);
    } catch (resumeError) {
      setError(formatDirectUploadError(resumeError));
      setIsSaving(false);
    }
  }

  async function onCancelMultipartUpload() {
    if (!multipartResumeState) return;
    setError(null);
    setUploadStatus("Aborting multipart upload...");
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/meeting-intake-multipart-upload-sessions/${multipartResumeState.uploadSessionId}/abort`,
        { method: "POST" }
      );
      const body = await response.json().catch(() => null) as DirectUploadFinalizeResponse | null;
      if (!response.ok) throw new Error(directUploadErrorMessage(body?.error, "Could not abort the multipart upload."));
      clearMultipartResumeState(workspaceId);
      setMultipartResumeState(null);
      setUploadStatus("Multipart upload canceled.");
    } catch (abortError) {
      setError(formatDirectUploadError(abortError));
      setUploadStatus("Multipart upload is still resumable.");
    }
  }

  async function uploadWithRetry(upload: DirectUploadInstruction, file: File) {
    const uploadRequest = () => fetch(upload.url, {
      body: file,
      headers: upload.headers,
      method: upload.method
    });
    let response = await uploadRequest().catch(() => null);
    if (response?.ok || !canRetrySignedUpload(upload.expiresAt)) return response ?? new Response(null, { status: 503 });
    setUploadStatus("Retrying upload...");
    response = await uploadRequest().catch(() => null);
    return response ?? new Response(null, { status: 503 });
  }

  function directUploadErrorMessage(error: DirectUploadError | undefined, fallback: string) {
    switch (error?.code) {
      case "MEETING_INTAKE_STORED_FILE_EXPIRED":
      case "MEETING_INTAKE_STORED_FILE_MISSING":
        return "Upload session expired or the uploaded file is no longer available. Choose the file and try again.";
      case "MEETING_INTAKE_STORED_FILE_SIZE_MISMATCH":
        return "Uploaded file size did not match the upload session. Choose the file and try again.";
      case "MEETING_INTAKE_STORED_FILE_CHECKSUM_MISMATCH":
        return "Uploaded file checksum did not match the upload session. Choose the file and try again.";
      case "MEETING_INTAKE_PROVIDER_UNSUPPORTED_MEDIA":
      case "MEETING_INTAKE_PROVIDER_UNAVAILABLE":
        return error.message ?? "The configured provider does not support this file type.";
      case "MEETING_INTAKE_DIRECT_UPLOAD_INVALID_STATE":
      case "MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE":
        return "This upload session is no longer waiting for completion. Open the intake or start a new upload.";
      default:
        return error?.message ?? fallback;
    }
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {multipartResumeState ? (
        <div className="form-banner meeting-resume-banner" role="status">
          <strong>Interrupted upload: {multipartResumeState.fileLabel}</strong>
          <small className="form-hint">
            {multipartResumeState.uploadedParts.length} of {multipartResumeState.partCount} parts uploaded. Expires {formatResumeExpiry(multipartResumeState.expiresAt)}.
          </small>
          <progress
            aria-label="Multipart upload resume progress"
            className="meeting-upload-progress"
            max={multipartResumeState.partCount}
            value={multipartResumeState.uploadedParts.length}
          />
          <div className="panel-actions-row">
            <button
              className="button-primary button-compact"
              disabled={isSaving}
              onClick={(event) => onResumeMultipartUpload(event.currentTarget.form)}
              type="button"
            >
              Resume
            </button>
            <button className="button-secondary button-compact" disabled={isSaving} onClick={onCancelMultipartUpload} type="button">
              Cancel upload
            </button>
          </div>
        </div>
      ) : null}
      <div className="form-grid">
        <label className="form-field">
          <FormFieldLabel>Source type</FormFieldLabel>
          <select name="sourceType" defaultValue="">
            <option value="">Detect from input</option>
            <option value="pasted_text">Pasted text</option>
            <option value="markdown">Markdown</option>
            <option value="text_file">Text file</option>
            <option value="rtf">RTF</option>
            <option value="html">HTML</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="pdf">PDF</option>
            <option value="docx">Word/DOCX</option>
            <option value="image">Image/whiteboard</option>
            <option value="audio">Audio</option>
            <option value="video">Video</option>
          </select>
        </label>
        <label className="form-field">
          <FormFieldLabel>Artifact file</FormFieldLabel>
          <input
            accept=".txt,.md,.rtf,.html,.htm,.csv,.json,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.mp3,.m4a,.wav,.mp4,.mov,.webm,text/plain,text/markdown,text/rtf,text/html,text/csv,application/json"
            onChange={(event) => onFileChange(event.target.files?.[0])}
            type="file"
          />
          {fileNotice ? <small className="form-hint form-hint-info">{fileNotice}</small> : null}
          {uploadCapabilities ? <small className="form-hint">{uploadCapabilities.guidance.summary}</small> : null}
          {uploadStatus ? (
            <small className="form-hint form-hint-status" role="status" aria-live="polite">
              {uploadStatus}
            </small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <FormFieldLabel>Meeting notes or transcript</FormFieldLabel>
          <textarea name="text" placeholder="Paste discovery notes, meeting notes, transcript excerpts, or markdown..." rows={10} />
        </label>
        <label className="form-field form-field-wide">
          <FormFieldLabel>Context</FormFieldLabel>
          <textarea
            name="contextText"
            placeholder="Meeting date, attendees, customer, deal context, project phase, missing names, or anything the artifact does not include."
            rows={4}
          />
        </label>
        <label className="form-field">
          <FormFieldLabel>Known deal</FormFieldLabel>
          <select name="dealId" defaultValue="">
            <option value="">No deal hint</option>
            {options.deals.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <FormFieldLabel>Known lead</FormFieldLabel>
          <select name="leadId" defaultValue="">
            <option value="">No lead hint</option>
            {options.leads.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <FormFieldLabel>Known organization</FormFieldLabel>
          <select name="organizationId" defaultValue="">
            <option value="">No organization hint</option>
            {options.organizations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <FormFieldLabel>Known contacts</FormFieldLabel>
          <select name="personIds" multiple size={5}>
            {options.people.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="panel-actions-row meeting-file-support-row" aria-label="Meeting Intelligence file support">
        <Badge>
          <FileText size={14} aria-hidden="true" /> Supported: pasted text, markdown, .txt, .md, .rtf, .html, .csv, .json, text-based PDF, DOCX
        </Badge>{" "}
        <Badge>
          <Wand2 size={14} aria-hidden="true" /> Provider-backed: images, whiteboards, scanned PDFs, audio, video
        </Badge>{" "}
        <Badge>
          <FileText size={14} aria-hidden="true" /> Unsupported: PPTX, XLSX, legacy .doc
        </Badge>
      </div>
      <UploadCapabilityGuide capabilities={uploadCapabilities} />
      <FormActionBar
        disabledHint="Add pasted notes or choose a file."
        isSaving={isSaving}
        pendingLabel={uploadStatus ?? "Analyzing..."}
        submitLabel="Analyze intake"
      />
    </form>
  );
}

function UploadCapabilityGuide({ capabilities }: { capabilities: MeetingUploadCapabilities | null }) {
  const directUploadSummary = capabilities?.directUpload.available
    ? `Direct upload ready for ${sourceTypeList(capabilities.directUpload.sourceTypes)} up to ${formatBytes(capabilities.directUpload.maxBytes)}.`
    : capabilities?.directUpload.reason ?? "Direct upload status is loading; local notes and small supported files can still be analyzed.";
  const multipartSummary = capabilities?.multipartUpload.supported
    ? `Multipart upload resumes interrupted provider files from ${formatBytes(capabilities.multipartUpload.minBytes)} to ${formatBytes(capabilities.multipartUpload.maxBytes)}.`
    : capabilities?.multipartUpload.reason ?? "Multipart upload status is loading.";
  const providerSummary = capabilities?.providerExtraction.configured
    ? `Provider extraction is configured for ${sourceTypeList(capabilities.providerExtraction.supportedSourceTypes)}.`
    : "Images, whiteboards, scanned PDFs, audio, and video require a configured provider before they can be extracted or transcribed.";
  const localLimit = capabilities ? `Local binary extraction limit: ${formatBytes(capabilities.localExtraction.maxBinaryBytes)}.` : "Local extraction limits are loading.";

  return (
    <div className="meeting-intake-upload-capabilities" aria-label="Meeting Intelligence upload capability guidance">
      <div className="meeting-upload-capability-card">
        <strong>
          <FileText size={15} aria-hidden="true" /> Local extraction
        </strong>
        <span>Text, markdown, RTF, HTML, CSV, JSON, text-based PDF, and DOCX are converted before review.</span>
        <small>{localLimit}</small>
      </div>
      <div className="meeting-upload-capability-card">
        <strong>
          <UploadCloud size={15} aria-hidden="true" /> Direct and multipart upload
        </strong>
        <span>{directUploadSummary}</span>
        <small>{multipartSummary}</small>
      </div>
      <div className="meeting-upload-capability-card">
        <strong>
          <Wand2 size={15} aria-hidden="true" /> Provider extraction
        </strong>
        <span>{providerSummary}</span>
        <small>Scanned PDF or video without provider support is blocked with a clear provider/file message.</small>
      </div>
      <div className="meeting-upload-capability-card">
        <strong>
          <ShieldCheck size={15} aria-hidden="true" /> Review-first apply
        </strong>
        <span>Analysis creates editable proposals first; nothing is written to CRM records until you apply selected updates.</span>
        <small>{capabilities?.guidance.unsupported ?? "Unsupported files are blocked before upload."}</small>
      </div>
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary);
}

async function fileSha256(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shouldReadFileForFallback(file: File) {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx") ||
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type.startsWith("image/") ||
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    /\.(jpe?g|png|m4a|mp3|wav|mov|mp4|webm)$/i.test(file.name)
  );
}

function isDirectUploadFallbackError(response: DirectUploadSessionResponse | null) {
  const code = response?.error?.code;
  return (
    code === "MEETING_INTAKE_DIRECT_UPLOAD_UNAVAILABLE" ||
    code === "MEETING_INTAKE_DIRECT_UPLOAD_UNSUPPORTED" ||
    code === "MEETING_INTAKE_PROVIDER_NOT_CONFIGURED" ||
    code === "MEETING_INTAKE_PROVIDER_UNAVAILABLE" ||
    code === "MEETING_INTAKE_PROVIDER_UNSUPPORTED_MEDIA" ||
    code === "MEETING_INTAKE_UNSUPPORTED_MEDIA"
  );
}

function formatDirectUploadError(error: unknown) {
  return error instanceof Error ? error.message : "Could not upload the meeting artifact.";
}

function canRetrySignedUpload(expiresAt: string | undefined) {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - Date.now() > 30_000;
}

function formInputFromForm(form: HTMLFormElement | null) {
  const formData = form ? new FormData(form) : new FormData();
  return {
    contextText: String(formData.get("contextText") ?? ""),
    hints: {
      dealId: String(formData.get("dealId") ?? ""),
      leadId: String(formData.get("leadId") ?? ""),
      organizationId: String(formData.get("organizationId") ?? ""),
      personIds: formData.getAll("personIds").map(String)
    },
    sourceType: String(formData.get("sourceType") ?? "")
  };
}

function multipartResumeStorageKey(workspaceId: string) {
  return `northstar:meeting-intelligence:multipart-resume:${workspaceId}`;
}

function readMultipartResumeState(workspaceId: string): MultipartResumeState | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeMultipartResumeState(JSON.parse(window.localStorage.getItem(multipartResumeStorageKey(workspaceId)) ?? "null"), workspaceId);
  } catch {
    clearMultipartResumeState(workspaceId);
    return null;
  }
}

function persistMultipartResumeState(state: MultipartResumeState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(multipartResumeStorageKey(state.workspaceId), JSON.stringify(state));
}

function clearMultipartResumeState(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(multipartResumeStorageKey(workspaceId));
}

function normalizeMultipartResumeState(value: unknown, workspaceId: string): MultipartResumeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const uploadedParts = Array.isArray(input.uploadedParts)
    ? input.uploadedParts.map(normalizeMultipartCompletedPart).filter((part): part is MultipartCompletedPart => Boolean(part))
    : [];
  const state = {
    byteLength: integerInput(input.byteLength),
    createdAt: stringInput(input.createdAt),
    expiresAt: stringInput(input.expiresAt),
    fileLabel: stringInput(input.fileLabel),
    originalFilename: stringInput(input.originalFilename),
    originalMimeType: stringInput(input.originalMimeType),
    partCount: integerInput(input.partCount),
    partSizeBytes: integerInput(input.partSizeBytes),
    sha256: stringInput(input.sha256),
    sourceType: input.sourceType,
    uploadedParts,
    uploadSessionId: stringInput(input.uploadSessionId),
    workspaceId: stringInput(input.workspaceId)
  };
  if (
    state.workspaceId !== workspaceId ||
    !state.uploadSessionId ||
    !state.fileLabel ||
    !state.createdAt ||
    !state.expiresAt ||
    !state.byteLength ||
    !state.partCount ||
    !state.partSizeBytes ||
    !/^[a-f0-9]{64}$/i.test(state.sha256 ?? "") ||
    !(state.sourceType === "audio" || state.sourceType === "image" || state.sourceType === "pdf" || state.sourceType === "video")
  ) {
    return null;
  }
  return state as MultipartResumeState;
}

function normalizeMultipartCompletedPart(value: unknown): MultipartCompletedPart | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const partNumber = integerInput(input.partNumber);
  const etag = stringInput(input.etag);
  if (!partNumber || !etag || etag.length > 200 || /[\r\n<>]/.test(etag)) return null;
  return { etag, partNumber };
}

function multipartResumeStateIsExpired(state: MultipartResumeState) {
  return Date.parse(state.expiresAt) <= Date.now();
}

async function inspectMultipartResumeState(workspaceId: string, state: MultipartResumeState): Promise<MultipartInspectResponse> {
  const response = await fetch(`/api/v1/workspaces/${workspaceId}/meeting-intake-multipart-upload-sessions/${state.uploadSessionId}`);
  const body = await response.json().catch(() => null) as (MultipartInspectResponse & { error?: DirectUploadError }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error?.message ?? "Could not inspect the interrupted multipart upload.");
  }
  return body;
}

function mergeMultipartResumeState(localState: MultipartResumeState, inspected: MultipartInspectAwaitingResponse): MultipartResumeState {
  const parts = new Map(localState.uploadedParts.map((part) => [part.partNumber, part]));
  for (const part of inspected.multipart.uploadedParts) {
    parts.set(part.partNumber, { etag: part.etag, partNumber: part.partNumber });
  }
  return {
    ...localState,
    byteLength: inspected.byteLength,
    expiresAt: inspected.multipart.expiresAt,
    originalFilename: inspected.originalFilename ?? localState.originalFilename,
    originalMimeType: inspected.originalMimeType ?? localState.originalMimeType,
    partCount: inspected.multipart.partCount,
    partSizeBytes: inspected.multipart.partSizeBytes,
    sha256: inspected.sha256,
    sourceType: inspected.acceptedSourceType,
    uploadedParts: Array.from(parts.values())
      .filter((part) => part.partNumber >= 1 && part.partNumber <= inspected.multipart.partCount)
      .sort((a, b) => a.partNumber - b.partNumber)
  };
}

function formatResumeExpiry(expiresAt: string) {
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return "soon";
  return new Date(parsed).toLocaleString();
}

function stringInput(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerInput(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function capabilityAwareFileNotice(message: string, file: File, capabilities: MeetingUploadCapabilities | null) {
  const gate = uploadGateForFile(file, "", capabilities);
  const mode = uploadModeForFile(file, "", capabilities);
  if (!gate.allowed) return `${message} ${gate.message}`;
  if (mode === "direct") return `${message} Direct upload will be used for this file.`;
  if (mode === "multipart") return `${message} Multipart upload will be used for this file.`;
  if (mode === "provider-fallback") return `${message} This file will use the bounded app upload path before provider extraction.`;
  return message;
}

function uploadGateForFile(file: File, explicitSourceType: string, capabilities: MeetingUploadCapabilities | null): { allowed: true } | { allowed: false; message: string } {
  if (!capabilities) return { allowed: true };
  const sourceType = detectedFileSourceType(file, explicitSourceType);
  const providerSupport = providerSupportForSource(sourceType, capabilities);

  if (sourceType === "pptx" || sourceType === "xlsx" || sourceType === "unsupported") {
    return { allowed: false, message: unsupportedSourceMessage(sourceType, capabilities) };
  }
  if (sourceType === "docx" && file.size > capabilities.localExtraction.maxBinaryBytes) {
    return {
      allowed: false,
      message: `DOCX local extraction is limited to ${formatBytes(capabilities.localExtraction.maxBinaryBytes)}. Paste the notes or upload a smaller .docx file.`
    };
  }
  if (sourceType === "pdf" && file.size > capabilities.localExtraction.maxBinaryBytes && !providerSupport?.available) {
    return {
      allowed: false,
      message: `Large or scanned PDFs require a PDF-capable provider. Local PDF extraction is limited to ${formatBytes(capabilities.localExtraction.maxBinaryBytes)}.`
    };
  }
  if ((sourceType === "image" || sourceType === "audio" || sourceType === "video") && !providerSupport?.available) {
    return { allowed: false, message: providerSupport?.reason ?? "This provider-backed file type is not available in this environment." };
  }
  if ((sourceType === "image" || sourceType === "audio" || sourceType === "video" || sourceType === "pdf") && providerSupport?.available) {
    const directSupported = capabilities.directUpload.available && capabilities.directUpload.sourceTypes.includes(sourceType);
    const multipartSupported = capabilities.multipartUpload.supported && capabilities.multipartUpload.sourceTypes.includes(sourceType);
    const maxBytes = multipartSupported
      ? capabilities.multipartUpload.maxBytes
      : directSupported
        ? capabilities.directUpload.maxBytes
        : capabilities.base64Request.providerFallbackMaxBytes;
    if (file.size > maxBytes) {
      return {
        allowed: false,
        message: `${sourceType.toUpperCase()} files are limited to ${formatBytes(maxBytes)} in this environment.`
      };
    }
  }
  return { allowed: true };
}

function uploadModeForFile(file: File, explicitSourceType: string, capabilities: MeetingUploadCapabilities | null) {
  if (!capabilities) return "unknown";
  const sourceType = detectedFileSourceType(file, explicitSourceType);
  if (!(sourceType === "image" || sourceType === "audio" || sourceType === "video" || sourceType === "pdf")) return "local";
  if (
    file.size >= capabilities.directUpload.minBytes &&
    file.size <= capabilities.directUpload.maxBytes &&
    capabilities.directUpload.available &&
    capabilities.directUpload.sourceTypes.includes(sourceType)
  ) {
    return "direct";
  }
  if (
    file.size >= capabilities.multipartUpload.minBytes &&
    file.size <= capabilities.multipartUpload.maxBytes &&
    capabilities.multipartUpload.supported &&
    capabilities.multipartUpload.sourceTypes.includes(sourceType)
  ) {
    return "multipart";
  }
  if (providerSupportForSource(sourceType, capabilities)?.available) return "provider-fallback";
  return "unsupported";
}

function directUploadDecision(file: File, sourceType: "audio" | "image" | "pdf" | "video", capabilities: MeetingUploadCapabilities | null):
  | { action: "direct" }
  | { action: "multipart" }
  | { action: "fallback"; message: string }
  | { action: "block"; message: string } {
  if (!capabilities) return { action: "direct" };
  const gate = uploadGateForFile(file, sourceType, capabilities);
  if (!gate.allowed) return { action: "block", message: gate.message };
  if (
    capabilities.directUpload.available &&
    capabilities.directUpload.sourceTypes.includes(sourceType) &&
    file.size >= capabilities.directUpload.minBytes &&
    file.size <= capabilities.directUpload.maxBytes
  ) {
    return { action: "direct" };
  }
  if (
    capabilities.multipartUpload.supported &&
    capabilities.multipartUpload.sourceTypes.includes(sourceType) &&
    file.size >= capabilities.multipartUpload.minBytes &&
    file.size <= capabilities.multipartUpload.maxBytes
  ) {
    return { action: "multipart" };
  }
  return {
    action: "fallback",
    message: "Direct upload is not available for this file in this environment; using standard upload."
  };
}

function detectedFileSourceType(file: File, explicitSourceType: string) {
  return detectMeetingSource({
    explicitSourceType,
    filename: file.name,
    mimeType: file.type
  }).sourceType;
}

function providerSupportForSource(sourceType: string, capabilities: MeetingUploadCapabilities) {
  return sourceType === "image" || sourceType === "audio" || sourceType === "video" || sourceType === "pdf"
    ? capabilities.providerExtraction.support[sourceType]
    : undefined;
}

function unsupportedSourceMessage(sourceType: string, capabilities: MeetingUploadCapabilities) {
  return capabilities.unsupportedSourceTypes.find((item) => item.sourceType === sourceType)?.reason ?? capabilities.guidance.unsupported;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function sourceTypeList(sourceTypes: string[]) {
  return sourceTypes.length > 0 ? sourceTypes.join(", ") : "no provider-backed source types";
}

type DirectUploadError = {
  code?: string;
  message?: string;
};

type DirectUploadSessionResponse = {
  error?: DirectUploadError;
  upload?: DirectUploadInstruction;
  uploadSessionId?: string;
};

type DirectUploadFinalizeResponse = {
  error?: DirectUploadError;
  id?: string;
};

type DirectUploadInstruction = {
  expiresAt?: string;
  headers: Record<string, string>;
  method: "PUT";
  url: string;
};

type MultipartUploadSessionResponse = {
  error?: DirectUploadError;
  multipart?: {
    expiresAt: string;
    partCount: number;
    partSizeBytes: number;
  };
  uploadSessionId?: string;
};

type MultipartUploadPartsResponse = {
  error?: DirectUploadError;
  parts?: Array<{
    partNumber: number;
    upload: DirectUploadInstruction;
  }>;
};

type MultipartCompletedPart = {
  etag: string;
  partNumber: number;
};

type MultipartResumeState = {
  byteLength: number;
  createdAt: string;
  expiresAt: string;
  fileLabel: string;
  originalFilename?: string;
  originalMimeType?: string;
  partCount: number;
  partSizeBytes: number;
  sha256: string;
  sourceType: "audio" | "image" | "pdf" | "video";
  uploadedParts: MultipartCompletedPart[];
  uploadSessionId: string;
  workspaceId: string;
};

type MultipartInspectQueuedResponse = {
  abortAllowed: false;
  error?: DirectUploadError;
  intakeId: string;
  resumeAllowed: false;
  status: "queued";
  uploadSessionId: string;
};

type MultipartInspectAwaitingResponse = {
  abortAllowed: true;
  acceptedSourceType: "audio" | "image" | "pdf" | "video";
  byteLength: number;
  error?: DirectUploadError;
  intakeId: string;
  multipart: {
    expiresAt: string;
    maxParts: number;
    partCount: number;
    partSizeBytes: number;
    uploadedPartCount: number;
    uploadedParts: Array<MultipartCompletedPart & { sizeBytes?: number }>;
  };
  originalFilename?: string;
  originalMimeType?: string;
  resumeAllowed: true;
  sha256: string;
  status: "awaiting_parts";
  uploadSessionId: string;
};

type MultipartInspectResponse = MultipartInspectAwaitingResponse | MultipartInspectQueuedResponse;

type MeetingUploadCapabilities = {
  base64Request: {
    available: boolean;
    maxDecodedBytes: number;
    maxEncodedCharacters: number;
    providerFallbackMaxBytes: number;
  };
  directUpload: {
    available: boolean;
    maxBytes: number;
    minBytes: number;
    reason?: string;
    sourceTypes: Array<"audio" | "image" | "pdf" | "video">;
  };
  guidance: {
    fallback: string;
    summary: string;
    tooLarge: string;
    unsupported: string;
  };
  localExtraction: {
    maxBinaryBytes: number;
    maxTextCharacters: number;
    sourceTypes: string[];
  };
  multipartUpload: {
    abortSupported: boolean;
    cleanup: string;
    maxBytes: number;
    maxParts: number;
    minBytes: number;
    partSizeBytes: number;
    reason?: string;
    sourceTypes: Array<"audio" | "image" | "pdf" | "video">;
    supported: boolean;
  };
  providerExtraction: {
    configured: boolean;
    sourceTypes: Array<"audio" | "image" | "pdf" | "video">;
    support: Record<"audio" | "image" | "pdf" | "video", { available: boolean; directUpload: boolean; reason?: string }>;
    supportedSourceTypes: Array<"audio" | "image" | "pdf" | "video">;
  };
  storage: {
    backendCategory: "local-filesystem" | "s3-compatible";
    directUploadSupported: boolean;
    private: boolean;
    retentionDays: number;
  };
  unsupportedSourceTypes: Array<{ reason: string; sourceType: string }>;
};
