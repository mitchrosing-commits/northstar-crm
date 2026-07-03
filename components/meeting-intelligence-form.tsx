"use client";

import { FileText, Wand2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Badge } from "@/components/badge";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";

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
  const [fileBase64, setFileBase64] = useState("");
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileMime, setFileMime] = useState("");
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onFileChange(file: File | undefined) {
    setFileBase64("");
    setFileText("");
    setFileName(file?.name ?? "");
    setFileMime(file?.type ?? "");
    setFileNotice(null);
    if (!file) return;
    const lower = file.name.toLowerCase();
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
      setFileNotice("Text, RTF, HTML, CSV, JSON, and markdown files extract locally before review.");
      return;
    }
    if (lower.endsWith(".pdf") || file.type === "application/pdf") {
      setFileBase64(arrayBufferToBase64(await file.arrayBuffer()));
      setFileNotice("Text-based PDFs extract locally. Scanned PDFs stop with an OCR or vision provider requirement.");
      return;
    }
    if (
      lower.endsWith(".docx") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      setFileBase64(arrayBufferToBase64(await file.arrayBuffer()));
      setFileNotice("DOCX files extract locally before review.");
      return;
    }
    if (lower.endsWith(".doc") || file.type === "application/msword") {
      setFileNotice("Legacy .doc files are not supported. Convert the document to .docx before intake.");
      return;
    }
    if (
      lower.endsWith(".pptx") ||
      file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      setFileNotice("PPTX decks are not locally parsed yet. Export to PDF, DOCX, markdown, HTML, or text before intake.");
      return;
    }
    if (lower.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      setFileNotice("XLSX workbooks are not locally parsed yet. Export to CSV, markdown, HTML, or text before intake.");
      return;
    }
    if (file.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(file.name)) {
      setFileNotice("Images and whiteboards require an OCR or vision provider. The intake will record that boundary clearly.");
      return;
    }
    if (file.type.startsWith("audio/") || /\.(m4a|mp3|wav)$/i.test(file.name)) {
      setFileNotice("Audio recordings require a transcription provider. The intake will record that boundary clearly.");
      return;
    }
    if (file.type.startsWith("video/") || /\.(mov|mp4|webm)$/i.test(file.name)) {
      setFileNotice("Video recordings require transcription or media processing. The intake will record that boundary clearly.");
      return;
    }
    setFileNotice("This file type is not supported yet and will fail with a clear processor requirement.");
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
    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/meeting-intakes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextText,
        explicitSourceType: String(formData.get("sourceType") ?? ""),
        fileBase64,
        fileText,
        hints: {
          dealId: String(formData.get("dealId") ?? ""),
          leadId: String(formData.get("leadId") ?? ""),
          organizationId: String(formData.get("organizationId") ?? ""),
          personIds: formData.getAll("personIds").map(String)
        },
        originalFilename: fileName,
        originalMimeType: fileMime,
        text
      })
    });

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.id) {
      setError(body?.error?.message ?? "Could not create the meeting intake.");
      setIsSaving(false);
      return;
    }
    router.push(`/meeting-intelligence/${body.id}` as Route);
    router.refresh();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
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
          {fileNotice ? <small className="form-hint">{fileNotice}</small> : null}
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
      <div className="panel-actions-row" aria-label="Meeting Intelligence file support">
        <Badge>
          <FileText size={14} aria-hidden="true" /> Supported: pasted text, markdown, .txt, .md, .rtf, .html, .csv, .json, text-based PDF, DOCX
        </Badge>{" "}
        <Badge>
          <Wand2 size={14} aria-hidden="true" /> Deferred: PPTX, XLSX, whiteboard images, audio, video, scanned PDFs
        </Badge>
      </div>
      <FormActionBar
        disabledHint="Add pasted notes or choose a file."
        isSaving={isSaving}
        pendingLabel="Analyzing..."
        submitLabel="Analyze intake"
      />
    </form>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}
