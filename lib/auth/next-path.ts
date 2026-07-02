const defaultAuthNextPath = "/dashboard";
const authNextPathBaseUrl = new URL("https://northstar.local");

export function sanitizeAuthNextPath(nextPath: unknown) {
  if (typeof nextPath !== "string") return defaultAuthNextPath;
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return defaultAuthNextPath;
  if (hasUnsafeRedirectCharacters(nextPath)) return defaultAuthNextPath;

  const parsed = parseAuthNextPath(nextPath);
  if (!parsed || parsed.origin !== authNextPathBaseUrl.origin) return defaultAuthNextPath;
  if (parsed.pathname.startsWith("/login") || parsed.pathname.startsWith("/signup")) return defaultAuthNextPath;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function hasUnsafeRedirectCharacters(nextPath: string) {
  return /[\u0000-\u001f\u007f\\]/.test(nextPath);
}

function parseAuthNextPath(nextPath: string) {
  try {
    return new URL(nextPath, authNextPathBaseUrl);
  } catch {
    return null;
  }
}
