import { Badge } from "@/components/badge";

export function StatusBadge({ status }: { status: string }) {
  const statusLabel = formatStatusBadgeLabel(status);
  const accessibleLabel = `Status: ${statusLabel}`;
  const statusSlug = statusLabel
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const statusClassName = `badge badge-${statusSlug || "default"}`;

  return (
    <Badge className={statusClassName} label={accessibleLabel}>
      {statusLabel}
    </Badge>
  );
}

export function formatStatusBadgeLabel(status: string) {
  const normalized = status.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return "Unknown";
  const lower = normalized.toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
}
