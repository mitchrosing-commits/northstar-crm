import type { Route } from "next";

const allowedReturnPathPrefixes = [
  "/activities",
  "/assistant",
  "/contacts",
  "/custom-fields",
  "/dashboard",
  "/deals",
  "/email",
  "/leads",
  "/meeting-intelligence",
  "/onboarding",
  "/organizations",
  "/pipeline",
  "/products",
  "/quotes",
  "/reports",
  "/scheduler",
  "/search",
  "/settings",
  "/web-forms"
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
  if (path === "/assistant") return "Back to Assistant";
  if (path === "/contacts") return "Back to contacts";
  if (path.startsWith("/contacts/")) return "Back to contact";
  if (path === "/custom-fields") return "Back to custom fields";
  if (path === "/dashboard") return "Back to dashboard";
  if (path === "/deals") return "Back to deals";
  if (path.startsWith("/deals/")) return "Back to deal";
  if (path === "/email") return "Back to email";
  if (path === "/leads") return "Back to leads";
  if (path.startsWith("/leads/")) return "Back to lead";
  if (path === "/meeting-intelligence") return "Back to Meeting Intelligence";
  if (path.startsWith("/meeting-intelligence/")) return "Back to Meeting Intelligence";
  if (path === "/onboarding") return "Back to onboarding";
  if (path === "/organizations") return "Back to organizations";
  if (path.startsWith("/organizations/")) return "Back to organization";
  if (path === "/pipeline") return "Back to pipeline";
  if (path === "/products") return "Back to products";
  if (path === "/quotes") return "Back to quotes";
  if (path === "/reports") return "Back to reports";
  if (path === "/scheduler") return "Back to scheduler";
  if (path.startsWith("/scheduler/")) return "Back to scheduler";
  if (path === "/search") return "Back to search";
  if (path === "/settings") return "Back to settings";
  if (path.startsWith("/settings/")) return "Back to settings";
  if (path === "/web-forms") return "Back to web forms";
  if (path.startsWith("/web-forms/")) return "Back to web forms";

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
