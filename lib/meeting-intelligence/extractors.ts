import { ApiError } from "@/lib/api/responses";
import { parseCsv } from "@/lib/csv";
import { join } from "node:path";

import {
  isMediaProviderSourceType,
  mediaProviderRequiredMessage,
  type MediaExtractionKind,
  type MediaExtractionProvider
} from "./media-providers";
import { detectMeetingSource } from "./source-detection";
import type { ExtractedMeetingText, MeetingSourceType, SourceDetectionResult } from "./types";

export const meetingIntelligenceLocalBinaryMaxBytes = 8 * 1024 * 1024;
const pdfjsStandardFontDataUrl = `${join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts").replaceAll("\\", "/")}/`;

type ExtractMeetingTextInput = {
  explicitSourceType?: unknown;
  fileBase64?: unknown;
  fileText?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  text?: unknown;
};

type ExtractMeetingTextOptions = {
  mediaProvider?: MediaExtractionProvider | null;
  preferMediaProvider?: boolean;
  providerSourceType?: MediaExtractionKind;
};

type MeetingSourceProcessor = {
  extract(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText>;
  name: string;
  sourceType: MeetingSourceType;
};
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocumentLoadingTask = ReturnType<PdfJsModule["getDocument"]>;

export async function extractMeetingText(
  input: ExtractMeetingTextInput,
  options: ExtractMeetingTextOptions = {}
): Promise<ExtractedMeetingText> {
  const rawText = readText(input.fileText) ?? readText(input.text);
  const detection = detectMeetingSource({
    explicitSourceType: input.explicitSourceType,
    filename: input.filename,
    mimeType: input.mimeType,
    text: rawText
  });
  const processor = getMeetingSourceProcessor(detection.sourceType);

  if (options.preferMediaProvider && options.providerSourceType) {
    return extractWithMediaProvider(input, options.providerSourceType, options.mediaProvider, detection.sourceType);
  }

  if (detection.capability !== "supported") {
    if (isMediaProviderSourceType(detection.sourceType)) {
      return extractWithMediaProvider(input, detection.sourceType, options.mediaProvider);
    }
    throw unavailableExtractorError(detection);
  }

  return processor.extract(input);
}

async function extractWithMediaProvider(
  input: ExtractMeetingTextInput,
  providerSourceType: MediaExtractionKind,
  mediaProvider: MediaExtractionProvider | null | undefined,
  outputSourceType: MeetingSourceType = providerSourceType
): Promise<ExtractedMeetingText> {
  if (!mediaProvider?.supports(providerSourceType)) {
    throw new ApiError("MEETING_INTAKE_PROVIDER_NOT_CONFIGURED", mediaProviderRequiredMessage(providerSourceType), 422);
  }
  const bytes = readFileBytes(input.fileBase64, providerSourceType.toUpperCase() as "AUDIO" | "IMAGE" | "PDF" | "VIDEO");
  const result = await mediaProvider.extract({
    bytes: new Uint8Array(bytes),
    filename: readText(input.filename),
    mimeType: readText(input.mimeType),
    sourceType: providerSourceType
  });
  const rawText = result.text.trim();
  if (!rawText) throw new ApiError("MEETING_INTAKE_PROVIDER_EMPTY_RESULT", "Meeting media extraction provider returned no text.", 422);
  return {
    metadata: {
      byteLength: bytes.byteLength,
      conversionMode: "provider_required",
      extractionMethod: providerSourceType === "audio" || providerSourceType === "video" ? "provider-transcription" : "provider-ocr",
      filename: readText(input.filename),
      mimeType: readText(input.mimeType),
      processor: result.providerId,
      processorCapability: "supported",
      providerId: result.providerId,
      providerName: result.providerName,
      requiredProvider: providerSourceType === "audio" ? "transcription" : providerSourceType === "video" ? "media_processing" : "ocr_or_vision",
      sourceType: outputSourceType,
      warnings: result.warnings,
      wordCount: wordCount(rawText)
    },
    rawText,
    sourceType: outputSourceType,
    warnings: result.warnings
  };
}

export function getMeetingSourceProcessor(sourceType: MeetingSourceType): MeetingSourceProcessor {
  if (sourceType === "pasted_text" || sourceType === "markdown" || sourceType === "text_file") {
    return {
      name: "local-text",
      sourceType,
      extract: async (input) => extractPlainText(input, sourceType)
    };
  }
  if (sourceType === "rtf") {
    return {
      name: "local-rtf",
      sourceType,
      extract: extractRtf
    };
  }
  if (sourceType === "html") {
    return {
      name: "local-html",
      sourceType,
      extract: extractHtml
    };
  }
  if (sourceType === "csv") {
    return {
      name: "local-csv",
      sourceType,
      extract: extractCsv
    };
  }
  if (sourceType === "json") {
    return {
      name: "local-json",
      sourceType,
      extract: extractJson
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
      throw unavailableExtractorError(detectMeetingSource({ explicitSourceType: sourceType }));
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
      conversionMode: "local",
      extractionMethod: "local-text",
      filename: readText(input.filename),
      mimeType: readText(input.mimeType),
      processor: "local-text",
      processorCapability: "supported",
      sourceType,
      wordCount: wordCount(rawText)
    },
    rawText,
    sourceType,
    warnings: []
  };
}

async function extractRtf(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText> {
  const sourceText = readText(input.fileText) ?? readText(input.text);
  if (!sourceText) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", "RTF extraction requires uploaded RTF file text.", 422);
  }
  const converted = rtfToPlainText(sourceText);
  if (!converted.text) throw new ApiError("MEETING_INTAKE_EMPTY_DOCUMENT", "RTF did not contain extractable text.", 422);
  return extractedText(input, "rtf", "local-rtf", converted.text, converted.warnings, sourceText);
}

async function extractHtml(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText> {
  const sourceText = readText(input.fileText) ?? readText(input.text);
  if (!sourceText) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", "HTML extraction requires uploaded HTML file text.", 422);
  }
  const converted = htmlToMarkdown(sourceText);
  if (!converted.text) throw new ApiError("MEETING_INTAKE_EMPTY_DOCUMENT", "HTML did not contain extractable body text.", 422);
  return extractedText(input, "html", "local-html", converted.text, converted.warnings, sourceText);
}

async function extractCsv(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText> {
  const sourceText = readText(input.fileText) ?? readText(input.text);
  if (!sourceText) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", "CSV extraction requires uploaded CSV file text.", 422);
  }

  try {
    const parsed = parseCsv(sourceText);
    const converted = csvToMarkdown(parsed.headers, parsed.rows);
    if (!converted.text) throw new ApiError("MEETING_INTAKE_EMPTY_DOCUMENT", "CSV did not contain readable rows.", 422);
    return extractedText(input, "csv", "local-csv", converted.text, converted.warnings, sourceText);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "MEETING_INTAKE_PROCESSOR_FAILED",
      error instanceof Error ? `CSV could not be parsed. ${error.message}` : "CSV could not be parsed.",
      422
    );
  }
}

async function extractJson(input: ExtractMeetingTextInput): Promise<ExtractedMeetingText> {
  const sourceText = readText(input.fileText) ?? readText(input.text);
  if (!sourceText) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", "JSON extraction requires uploaded JSON file text.", 422);
  }

  try {
    const value = JSON.parse(sourceText) as unknown;
    const warnings: string[] = [];
    const text = jsonToMarkdown(value, warnings).trim();
    if (!text) throw new ApiError("MEETING_INTAKE_EMPTY_DOCUMENT", "JSON did not contain readable meeting content.", 422);
    return extractedText(input, "json", "local-json", text, warnings, sourceText);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", "JSON meeting artifact could not be parsed.", 422);
  }
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
        conversionMode: "local",
        extractionMethod: "local-pdf",
        filename: readText(input.filename),
        mimeType: readText(input.mimeType),
        pageCount: document.numPages,
        processor: "local-pdf",
        processorCapability: "supported",
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
        conversionMode: "local",
        extractionMethod: "local-docx",
        filename: readText(input.filename),
        mimeType: readText(input.mimeType),
        processor: "local-docx",
        processorCapability: "supported",
        sourceType: "docx",
        warnings,
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

function readFileBytes(value: unknown, label: "AUDIO" | "DOCX" | "IMAGE" | "PDF" | "VIDEO") {
  const fileBase64 = readText(value);

  if (!fileBase64) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${label} extraction requires uploaded ${label} file content.`, 422);
  }

  const bytes = Buffer.from(fileBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${label} file content was empty.`, 422);
  }
  if (bytes.byteLength > meetingIntelligenceLocalBinaryMaxBytes) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${label} files are limited to 8 MB for local extraction.`, 422);
  }

  return bytes;
}

function unavailableExtractorError(detection: SourceDetectionResult) {
  const messages: Record<MeetingSourceType, string> = {
    audio: "Audio transcription requires a transcription provider integration.",
    csv: "CSV extraction requires uploaded CSV file text.",
    docx: "DOCX extraction requires uploaded DOCX file content.",
    html: "HTML extraction requires uploaded HTML file text.",
    image: "Image and whiteboard extraction requires an OCR or vision provider integration.",
    json: "JSON extraction requires uploaded JSON file text.",
    markdown: "Text extraction requires pasted notes or extracted file text.",
    pasted_text: "Text extraction requires pasted notes or extracted file text.",
    pdf: "PDF extraction requires uploaded PDF file content.",
    pptx:
      "PPTX slide deck extraction needs a dedicated local presentation parser. Export the deck to PDF, DOCX, markdown, HTML, or text before intake.",
    rtf: "RTF extraction requires uploaded RTF file text.",
    text_file: "Text extraction requires pasted notes or extracted file text.",
    unsupported:
      "This source type is not supported by Meeting Intelligence. Legacy .doc files should be converted to .docx before intake.",
    video: "Video transcription requires a transcription or media processing provider integration.",
    xlsx:
      "XLSX spreadsheet extraction needs a dedicated local spreadsheet parser. Export the workbook to CSV, markdown, HTML, or text before intake."
  };

  return new ApiError("MEETING_INTAKE_PROCESSOR_UNAVAILABLE", detection.message ?? messages[detection.sourceType], 422);
}

function readText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function extractedText(
  input: ExtractMeetingTextInput,
  sourceType: MeetingSourceType,
  processor: string,
  rawText: string,
  warnings: string[] = [],
  sourceText = rawText
): ExtractedMeetingText {
  return {
    metadata: {
      byteLength: Buffer.byteLength(sourceText, "utf8"),
      conversionMode: "local",
      extractionMethod: processor,
      filename: readText(input.filename),
      mimeType: readText(input.mimeType),
      processor,
      processorCapability: "supported",
      sourceType,
      warnings,
      wordCount: wordCount(rawText)
    },
    rawText,
    sourceType,
    warnings
  };
}

function rtfToPlainText(source: string) {
  const warnings: string[] = ["RTF formatting was flattened to plain markdown-like text."];
  const ignoredDestinations = new Set([
    "author",
    "colortbl",
    "comment",
    "fonttbl",
    "footer",
    "footerf",
    "footerl",
    "footerr",
    "header",
    "headerf",
    "headerl",
    "headerr",
    "info",
    "object",
    "pict",
    "stylesheet",
    "xmlnstbl"
  ]);
  const stack: Array<{ ignorable: boolean; ucSkip: number }> = [{ ignorable: false, ucSkip: 1 }];
  let output = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const state = stack[stack.length - 1] ?? { ignorable: false, ucSkip: 1 };

    if (char === "{") {
      stack.push({ ...state });
      continue;
    }
    if (char === "}") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (char !== "\\") {
      if (!state.ignorable && char !== "\r" && char !== "\n") output += char;
      continue;
    }

    const next = source[index + 1];
    if (next === "\\" || next === "{" || next === "}") {
      if (!state.ignorable) output += next;
      index += 1;
      continue;
    }
    if (next === "'") {
      const hex = source.slice(index + 2, index + 4);
      const code = Number.parseInt(hex, 16);
      if (!state.ignorable && Number.isFinite(code)) output += String.fromCharCode(code);
      index += 3;
      continue;
    }

    const control = source.slice(index + 1).match(/^([a-zA-Z*]+)(-?\d+)? ?/);
    if (!control) continue;
    const word = control[1];
    const value = control[2] ? Number.parseInt(control[2], 10) : undefined;
    index += control[0].length;

    if (word === "*") {
      state.ignorable = true;
      continue;
    }
    if (ignoredDestinations.has(word)) {
      state.ignorable = true;
      continue;
    }
    if (state.ignorable) continue;
    if (word === "par" || word === "line") output += "\n";
    if (word === "tab") output += "\t";
    if (word === "emdash") output += "--";
    if (word === "endash") output += "-";
    if (word === "bullet") output += "- ";
    if (word === "uc" && value !== undefined) state.ucSkip = Math.max(0, value);
    if (word === "u" && value !== undefined) {
      output += String.fromCharCode(value < 0 ? value + 65536 : value);
      index += state.ucSkip;
    }
  }

  return { text: normalizeExtractedMarkdown(output), warnings };
}

function htmlToMarkdown(source: string) {
  const warnings: string[] = ["HTML markup was converted to readable markdown-like text."];
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  const body = withoutComments.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? withoutComments;
  const stripped = body
    .replace(/<(script|style|head|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, () => {
      if (!warnings.includes("Script, style, and non-content HTML blocks were ignored.")) {
        warnings.push("Script, style, and non-content HTML blocks were ignored.");
      }
      return "\n";
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, content: string) => {
      return `\n${"#".repeat(Number(level))} ${inlineHtmlText(content)}\n`;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, content: string) => `\n- ${inlineHtmlText(content)}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|aside|header|footer|blockquote|ul|ol|table|thead|tbody|tr)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, "");

  return { text: normalizeExtractedMarkdown(decodeHtmlEntities(stripped)), warnings };
}

function inlineHtmlText(value: string) {
  return normalizeInline(decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")));
}

function csvToMarkdown(headers: string[], rows: string[][]) {
  const warnings: string[] = [];
  const maxColumns = 12;
  const maxRows = 50;
  const safeHeaders = headers.slice(0, maxColumns);
  const safeRows = rows.slice(0, maxRows).map((row) => row.slice(0, maxColumns));
  if (headers.length > maxColumns) warnings.push(`CSV had ${headers.length} columns; only the first ${maxColumns} were included.`);
  if (rows.length > maxRows) warnings.push(`CSV had ${rows.length} rows; only the first ${maxRows} were included.`);
  const table = [
    `| ${safeHeaders.map(markdownTableCell).join(" | ")} |`,
    `| ${safeHeaders.map(() => "---").join(" | ")} |`,
    ...safeRows.map((row) => `| ${safeHeaders.map((_header, index) => markdownTableCell(row[index] ?? "")).join(" | ")} |`)
  ];
  return { text: table.join("\n"), warnings };
}

function jsonToMarkdown(value: unknown, warnings: string[], depth = 0): string {
  if (depth > 5) {
    if (!warnings.includes("Deep JSON content was truncated after 5 levels.")) {
      warnings.push("Deep JSON content was truncated after 5 levels.");
    }
    return "_Nested content truncated._";
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return jsonArrayToMarkdown(value, warnings, depth);
  if (typeof value === "object") return jsonObjectToMarkdown(value as Record<string, unknown>, warnings, depth);
  return "";
}

function jsonArrayToMarkdown(values: unknown[], warnings: string[], depth: number) {
  const maxItems = 50;
  const items = values.slice(0, maxItems);
  if (values.length > maxItems) warnings.push(`JSON array had ${values.length} items; only the first ${maxItems} were included.`);
  if (items.every(isPrimitiveRecord)) {
    const headers = unique(items.flatMap((item) => Object.keys(item as Record<string, unknown>))).slice(0, 12);
    if (headers.length > 0) {
      return [
        `| ${headers.map(markdownTableCell).join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...items.map((item) => {
          const row = item as Record<string, unknown>;
          return `| ${headers.map((header) => markdownTableCell(formatJsonPrimitive(row[header]))).join(" | ")} |`;
        })
      ].join("\n");
    }
  }
  return items
    .map((item) => {
      const rendered = jsonToMarkdown(item, warnings, depth + 1);
      return rendered.includes("\n") ? `- ${rendered.replace(/\n/g, "\n  ")}` : `- ${rendered}`;
    })
    .join("\n");
}

function jsonObjectToMarkdown(value: Record<string, unknown>, warnings: string[], depth: number) {
  const entries = Object.entries(value).slice(0, 80);
  if (Object.keys(value).length > 80) warnings.push("JSON object had more than 80 keys; extra keys were omitted.");
  return entries
    .map(([key, item]) => {
      if (item && typeof item === "object") {
        return `${"#".repeat(Math.min(depth + 2, 6))} ${titleizeJsonKey(key)}\n\n${jsonToMarkdown(item, warnings, depth + 1)}`;
      }
      return `- **${titleizeJsonKey(key)}:** ${formatJsonPrimitive(item)}`;
    })
    .join("\n\n");
}

function isPrimitiveRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => item === null || ["boolean", "number", "string"].includes(typeof item));
}

function formatJsonPrimitive(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function titleizeJsonKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function markdownTableCell(value: string) {
  return normalizeInline(value).replace(/\|/g, "\\|");
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function normalizeExtractedMarkdown(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeInline(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInline(value: string) {
  return value.replace(/[ \t\f\v]+/g, " ").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
