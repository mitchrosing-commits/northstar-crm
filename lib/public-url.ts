export function buildPublicQuoteUrl(token: string, appBaseUrl = process.env.APP_BASE_URL) {
  const path = `/q/${token}`;
  const baseUrl = appBaseUrl?.trim();
  if (!baseUrl) return path;

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

export function buildAppUrl(path: string, options: { appBaseUrl?: string; requestUrl?: string } = {}) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = (options.appBaseUrl ?? process.env.APP_BASE_URL)?.trim();

  if (baseUrl) {
    try {
      return new URL(normalizedPath, baseUrl).toString();
    } catch {
      // Fall through to the request URL fallback.
    }
  }

  if (options.requestUrl) {
    try {
      return new URL(normalizedPath, options.requestUrl).toString();
    } catch {
      return normalizedPath;
    }
  }

  return normalizedPath;
}
