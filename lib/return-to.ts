import type { Route } from "next";

const allowedReturnPathPrefixes = [
  "/activities",
  "/contacts",
  "/dashboard",
  "/deals",
  "/email",
  "/leads",
  "/organizations",
  "/pipeline",
  "/reports",
  "/search"
] as const;

export function parseReturnToHref(value: string | undefined, fallback: Route): Route {
  const trimmed = trimReturnToParam(value);
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;

  try {
    const parsed = new URL(trimmed, "https://northstar.local");
    if (parsed.origin !== "https://northstar.local") return fallback;
    const href = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return isAllowedReturnPath(href) ? (href as Route) : fallback;
  } catch {
    return fallback;
  }
}

export function returnToLabel(href: Route | string, fallbackLabel = "Back to source") {
  const path = String(href).split(/[?#]/)[0];

  if (path === "/activities" || path.startsWith("/activities/")) return "Back to activities";
  if (path === "/contacts") return "Back to contacts";
  if (path.startsWith("/contacts/")) return "Back to contact";
  if (path === "/dashboard") return "Back to dashboard";
  if (path === "/deals") return "Back to deals";
  if (path.startsWith("/deals/")) return "Back to deal";
  if (path === "/email") return "Back to email";
  if (path === "/leads") return "Back to leads";
  if (path.startsWith("/leads/")) return "Back to lead";
  if (path === "/organizations") return "Back to organizations";
  if (path.startsWith("/organizations/")) return "Back to organization";
  if (path === "/pipeline") return "Back to pipeline";
  if (path === "/reports") return "Back to reports";
  if (path === "/search") return "Back to search";

  return fallbackLabel;
}

function trimReturnToParam(value: string | undefined) {
  return value?.trim().slice(0, 500) ?? "";
}

function isAllowedReturnPath(href: string) {
  return allowedReturnPathPrefixes.some(
    (prefix) =>
      href === prefix ||
      href.startsWith(`${prefix}/`) ||
      href.startsWith(`${prefix}?`) ||
      href.startsWith(`${prefix}#`)
  );
}
