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
