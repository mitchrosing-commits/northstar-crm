import type { MeetingSourceMetadata, MeetingSourceType, NormalizedMeetingMarkdown } from "./types";

type NormalizeMeetingMarkdownInput = {
  contextText?: string | null;
  metadata?: MeetingSourceMetadata;
  originalFilename?: string | null;
  rawText: string;
  sourceType: MeetingSourceType;
};

export function normalizeMeetingMarkdown(input: NormalizeMeetingMarkdownInput): NormalizedMeetingMarkdown {
  const rawText = normalizeDocumentText(input.rawText);
  const contextText = normalizeWhitespace(input.contextText ?? "");
  const sections = extractSections(`${contextText}\n${rawText}`);
  const title = input.originalFilename ? `Meeting Intake: ${input.originalFilename}` : "Meeting Intake";
  const markdownSections = [
    `# ${title}`,
    sourceSection(input.sourceType, input.originalFilename, input.metadata),
    contextText ? `## User Context\n\n${contextText}` : "",
    sections.attendees.length > 0 ? `## Attendees\n\n${bullets(sections.attendees)}` : "",
    sections.decisions.length > 0 ? `## Decisions\n\n${bullets(sections.decisions)}` : "",
    sections.actionItems.length > 0 ? `## Action Items\n\n${bullets(sections.actionItems)}` : "",
    sections.risks.length > 0 ? `## Risks and Blockers\n\n${bullets(sections.risks)}` : "",
    sections.openQuestions.length > 0 ? `## Open Questions\n\n${bullets(sections.openQuestions)}` : "",
    `## Meeting Notes\n\n${rawText || "_No meeting notes were provided._"}`
  ].filter(Boolean);

  return {
    markdown: markdownSections.join("\n\n").trim(),
    sections
  };
}

export function extractSections(text: string): NormalizedMeetingMarkdown["sections"] {
  const lines = normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    actionItems: unique(lines.filter(isActionLine).map(cleanListLine)).slice(0, 12),
    attendees: unique(extractAttendees(lines)).slice(0, 20),
    decisions: unique(lines.filter(isDecisionLine).map(cleanListLine)).slice(0, 10),
    openQuestions: unique(lines.filter(isQuestionLine).map(cleanListLine)).slice(0, 10),
    risks: unique(lines.filter(isRiskLine).map(cleanListLine)).slice(0, 10)
  };
}

function sourceSection(sourceType: MeetingSourceType, originalFilename?: string | null, metadata?: MeetingSourceMetadata) {
  const labels: Record<MeetingSourceType, string> = {
    audio: "Audio",
    csv: "CSV",
    docx: "Word document",
    html: "HTML",
    image: "Image or whiteboard",
    json: "JSON",
    markdown: "Markdown",
    pasted_text: "Pasted text",
    pdf: "PDF",
    pptx: "PowerPoint deck",
    rtf: "Rich text",
    text_file: "Text file",
    unsupported: "Unsupported",
    video: "Video",
    xlsx: "Spreadsheet"
  };
  const details = [
    `- Source type: ${labels[sourceType]}`,
    originalFilename ? `- Original file: ${originalFilename}` : "",
    metadata?.mimeType ? `- MIME type: ${metadata.mimeType}` : "",
    metadata?.pageCount ? `- Pages: ${metadata.pageCount}` : "",
    metadata?.wordCount ? `- Extracted words: ${metadata.wordCount}` : "",
    metadata?.extractionMethod ? `- Extraction method: ${metadata.extractionMethod}` : "",
    metadata?.conversionMode ? `- Conversion: ${conversionLabel(metadata.conversionMode)}` : "",
    metadata?.processor ? `- Processor: ${metadata.processor}` : "",
    metadata?.providerName ? `- Provider: ${metadata.providerName}` : metadata?.providerId ? `- Provider: ${metadata.providerId}` : "",
    metadata?.statusMessage ? `- Processor status: ${metadata.statusMessage}` : "",
    ...(metadata?.warnings ?? []).map((warning) => `- Warning: ${warning}`)
  ].filter(Boolean);
  return `## Source\n\n${details.join("\n")}`;
}

function conversionLabel(value: NonNullable<MeetingSourceMetadata["conversionMode"]>) {
  if (value === "local") return "Local";
  if (value === "provider_required") return "Provider required";
  return "Unsupported";
}

function extractAttendees(lines: string[]) {
  const attendees: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(attendees?|participants?|present|joined|with)\s*:\s*(.+)$/i);
    if (!match) continue;
    attendees.push(
      ...match[2]
        .split(/,|;|\band\b/i)
        .map((part) => part.trim())
        .filter((part) => part.length > 1)
    );
  }
  return attendees;
}

function isActionLine(line: string) {
  return (
    /^\s*[-*]?\s*(todo|to do|action|action item|next step|follow[- ]?up)\b/i.test(line) ||
    /^\s*[-*]?\s*\[[ x]\]\s+/i.test(line) ||
    /\b(we need to|needs to|will|to follow up|follow up with|send|schedule|confirm|review|draft|share|provide|prepare|owner:|due:|by tomorrow|by next week|by friday|before go-live)\b/i.test(line)
  );
}

function isDecisionLine(line: string) {
  return /\b(decision|decided|agreed|approved|confirmed|selected|signed off)\b/i.test(line);
}

function isQuestionLine(line: string) {
  return line.endsWith("?") || /\b(open question|question|need to clarify|clarify|unknown|tbd)\b/i.test(line);
}

function isRiskLine(line: string) {
  return /\b(risk|blocker|blocked|concern|dependency|issue|delay|gap|constraint|migration concern|support need)\b/i.test(line);
}

function cleanListLine(line: string) {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])?\s*(\[[ x]\]\s*)?/i, "").trim();
}

function bullets(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeDocumentText(text: string) {
  return normalizeWhitespace(text)
    .replace(/\f/g, "\n\n---\n\n")
    .split("\n")
    .map((line) => normalizeDocumentLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeDocumentLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return "";
  if (/^[•▪◦]\s+/.test(trimmed)) return `- ${trimmed.replace(/^[•▪◦]\s+/, "")}`;
  if (/^\d+[.)]\s+\S/.test(trimmed)) return trimmed;
  if (/^[-*]\s+\S/.test(trimmed)) return trimmed;
  if (trimmed.length <= 80 && /^[A-Z][A-Za-z0-9 /&:()-]+$/.test(trimmed) && !/[.!?]$/.test(trimmed)) {
    return `### ${trimmed.replace(/:$/, "")}`;
  }
  return trimmed;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
