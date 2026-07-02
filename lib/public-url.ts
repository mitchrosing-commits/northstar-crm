import { isPublicHttpsUrl } from "@/lib/public-host";

export function buildPublicQuoteUrl(
  token: unknown,
  appBaseUrl = process.env.APP_BASE_URL,
  env: { NODE_ENV?: string } = process.env
) {
  const path = `/q/${encodeURIComponent(typeof token === "string" ? token : "")}`;
  const baseUrl = appBaseUrl?.trim();
  if (!baseUrl) return path;

  try {
    const base = new URL(baseUrl);
    if (base.username || base.password) return path;

    const publicUrl = new URL(path, base);
    if (env.NODE_ENV === "production" && !isPublicHttpsUrl(publicUrl)) return path;
    return publicUrl.toString();
  } catch {
    return path;
  }
}

export function buildAppUrl(path: unknown, options: { appBaseUrl?: string; requestUrl?: string } = {}) {
  const normalizedPath = normalizeAppPath(path);
  const baseUrl = (options.appBaseUrl ?? process.env.APP_BASE_URL)?.trim();

  if (baseUrl) {
    try {
      return new URL(normalizedPath, baseUrlWithoutCredentials(baseUrl)).toString();
    } catch {
      // Fall through to the request URL fallback.
    }
  }

  if (options.requestUrl) {
    try {
      return new URL(normalizedPath, baseUrlWithoutCredentials(options.requestUrl)).toString();
    } catch {
      return normalizedPath;
    }
  }

  return normalizedPath;
}

function normalizeAppPath(path: unknown) {
  if (typeof path !== "string") return "/";
  const trimmedPath = path.trim();
  if (!trimmedPath) return "/";
  return `/${trimmedPath.replace(/^\/+/, "")}`;
}

function baseUrlWithoutCredentials(value: string) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  return url;
}
