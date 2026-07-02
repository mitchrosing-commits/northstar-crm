import { ApiError } from "@/lib/api/responses";
import { join } from "node:path";

import { detectMeetingSource } from "./source-detection";
import type { ExtractedMeetingText, MeetingSourceType } from "./types";

const maxBinaryBytes = 8 * 1024 * 1024;
const pdfjsStandardFontDataUrl = `${join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts").replaceAll("\\", "/")}/`;

type ExtractMeetingTextInput = {
  explicitSourceType?: unknown;
  fileBase64?: unknown;
  fileText?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  text?: unknown;
};

type MeetingSourceProcessor = {
  extract(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText>;
  name: string;
  sourceType: MeetingSourceType;
};
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocumentLoadingTask = ReturnType<PdfJsModule["getDocument"]>;

export async function extractMeetingText(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText> {
  const rawText = readText(input.fileText) ?? readText(input.text);
  const detection = detectMeetingSource({
    explicitSourceType: input.explicitSourceType,
    filename: input.filename,
    mimeType: input.mimeType,
    text: rawText
  });
  const processor = getMeetingSourceProcessor(detection.sourceType);

  if (detection.capability !== "supported") {
    throw unsupportedExtractorError(detection.sourceType);
  }

  return processor.extract(input);
}

export function getMeetingSourceProcessor(sourceType: MeetingSourceType): MeetingSourceProcessor {
  if (sourceType === "pasted_text" || sourceType === "markdown" || sourceType === "text_file") {
    return {
      name: "local-text",
      sourceType,
      extract: async (input) => extractPlainText(input, sourceType)
    };
  }
  if (sourceType === "pdf") {
    return {
      name: "local-pdf",
      sourceType,
      extract: extractPdf
    };
  }
  if (sourceType === "docx") {
    return {
      name: "local-docx",
      sourceType,
      extract: extractDocx
    };
  }
  return {
    name: "provider-required",
    sourceType,
    extract: async () => {
      throw unsupportedExtractorError(sourceType);
    }
  };
}

async function extractPlainText(input: ExtractMeetingTextInput, sourceType: MeetingSourceType): Promise<ExtractedMeetingText> {
  const rawText = readText(input.fileText) ?? readText(input.text);

  if (!rawText) {
    throw new ApiError(
      "MEETING_INTAKE_PROCESSOR_FAILED",
      "Text extraction requires pasted notes or extracted file text.",
      422
    );
  }

  return {
    metadata: {
      byteLength: Buffer.byteLength(rawText, "utf8"),
      filename: readText(input.filename),
      mimeType: readText(input.mimeType),
      processor: "local-text",
      sourceType,
      wordCount: wordCount(rawText)
    },
    rawText,
    sourceType,
    warnings: []
  };
}

async function extractPdf(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText> {
  const bytes = readFileBytes(input.fileBase64, "PDF");
  let loadingTask: PdfDocumentLoadingTask | undefined;

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      standardFontDataUrl: pdfjsStandardFontDataUrl,
      useWorkerFetch: false
    });
    const document = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push(pageText);
    }

    const rawText = pages.filter(Boolean).join("\n\n\f\n\n").trim();
    if (!rawText) {
      throw new ApiError(
        "MEETING_INTAKE_OCR_REQUIRED",
        "PDF does not contain extractable text. OCR or vision provider integration is required for scanned PDFs.",
        422
      );
    }

    return {
      metadata: {
        byteLength: bytes.byteLength,
        filename: readText(input.filename),
        mimeType: readText(input.mimeType),
        pageCount: document.numPages,
        processor: "local-pdf",
        sourceType: "pdf",
        wordCount: wordCount(rawText)
      },
      rawText,
      sourceType: "pdf",
      warnings: []
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "MEETING_INTAKE_PROCESSOR_FAILED",
      "PDF could not be extracted. Upload a text-based PDF, paste the notes, or connect an OCR provider for scanned files.",
      422
    );
  } finally {
    await loadingTask?.destroy?.();
  }
}

async function extractDocx(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText> {
  const bytes = readFileBytes(input.fileBase64, "DOCX");

  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const rawText = result.value.replace(/\r\n/g, "\n").trim();

    if (!rawText) {
      throw new ApiError("MEETING_INTAKE_EMPTY_DOCUMENT", "DOCX did not contain extractable text.", 422);
    }

    const warnings = result.messages
      .map((message) => message.message.trim())
      .filter(Boolean)
      .map((message) => `DOCX parser warning: ${message}`);

    return {
      metadata: {
        byteLength: bytes.byteLength,
        filename: readText(input.filename),
        mimeType: readText(input.mimeType),
        processor: "local-docx",
        sourceType: "docx",
        wordCount: wordCount(rawText)
      },
      rawText,
      sourceType: "docx",
      warnings
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "MEETING_INTAKE_PROCESSOR_FAILED",
      "DOCX could not be extracted. Upload a valid .docx file or paste the notes.",
      422
    );
  }
}

function readFileBytes(value: unknown, label: "DOCX" | "PDF") {
  const fileBase64 = readText(value);

  if (!fileBase64) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${label} extraction requires uploaded ${label} file content.`, 422);
  }

  const bytes = Buffer.from(fileBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${label} file content was empty.`, 422);
  }
  if (bytes.byteLength > maxBinaryBytes) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${label} files are limited to 8 MB for local extraction.`, 422);
  }

  return bytes;
}

function unsupportedExtractorError(sourceType: MeetingSourceType) {
  const messages: Record<MeetingSourceType, string> = {
    audio: "Audio transcription requires a transcription provider integration.",
    docx: "DOCX extraction requires uploaded DOCX file content.",
    image: "Image and whiteboard extraction requires an OCR or vision provider integration.",
    markdown: "Text extraction requires pasted notes or extracted file text.",
    pasted_text: "Text extraction requires pasted notes or extracted file text.",
    pdf: "PDF extraction requires uploaded PDF file content.",
    text_file: "Text extraction requires pasted notes or extracted file text.",
    unsupported:
      "This source type is not supported by Meeting Intelligence. Legacy .doc files should be converted to .docx before intake.",
    video: "Video transcription requires a transcription or media processing provider integration."
  };

  return new ApiError("MEETING_INTAKE_PROCESSOR_UNAVAILABLE", messages[sourceType], 422);
}

function readText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}
