export function isPublicHttpsUrl(url: URL) {
  return url.protocol === "https:" && !url.username && !url.password && isPublicHost(url.hostname);
}

export function isPublicHost(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;
  if (isLocalDevelopmentHostname(normalized)) return false;

  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isPublicIpv4(ipv4);

  if (normalized.includes(":")) return isPublicIpv6(normalized);

  return true;
}

export function isLocalDevelopmentHost(hostname: string) {
  return isLocalDevelopmentHostname(normalizeHostname(hostname));
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isLocalDevelopmentHostname(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return ipv4[0] === 127 || (ipv4[0] === 0 && ipv4[1] === 0 && ipv4[2] === 0 && ipv4[3] === 0);
  return hostname === "::" || hostname === "::1";
}

function parseIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets as [number, number, number, number];
}

function isPublicIpv4([first, second]: [number, number, number, number]) {
  if (first === 0) return false;
  if (first === 10) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 0) return false;
  if (first === 192 && second === 2) return false;
  if (first === 192 && second === 168) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  if (first === 198 && second === 51) return false;
  if (first === 203 && second === 0) return false;
  if (first >= 224) return false;
  return true;
}

function isPublicIpv6(hostname: string) {
  if (hostname === "::" || hostname === "::1") return false;
  const embeddedIpv4 = parseKnownEmbeddedIpv4(hostname);
  if (embeddedIpv4) return isPublicIpv4(embeddedIpv4);
  if (hostname.startsWith("2001:db8")) return false;
  if (hostname.startsWith("2002:")) return false;
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return false;
  if (/^fe[89a-f]/.test(hostname)) return false;
  if (hostname.startsWith("ff")) return false;
  return true;
}

function parseKnownEmbeddedIpv4(hostname: string) {
  return (
    parseEmbeddedIpv4Suffix(hostname, "::ffff:") ??
    parseEmbeddedIpv4Suffix(hostname, "::") ??
    parseEmbeddedIpv4Suffix(hostname, "64:ff9b::")
  );
}

function parseEmbeddedIpv4Suffix(hostname: string, prefix: string) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = hostname.match(new RegExp(`^${escapedPrefix}([0-9a-f]{1,4}):([0-9a-f]{1,4})$`));
  if (!match) return null;

  const high = Number.parseInt(match[1] ?? "", 16);
  const low = Number.parseInt(match[2] ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null;
  }

  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff] as [number, number, number, number];
}
