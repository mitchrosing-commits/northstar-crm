type RecordSubtitlePart = string | null | undefined | false;

export function recordSubtitle(parts: RecordSubtitlePart[]) {
  const subtitle = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" · ");

  return subtitle || undefined;
}
