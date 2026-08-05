import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mappedDotted = normalized.match(/^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isBlockedIpv4([high >> 8, high & 255, low >> 8, low & 255].join("."));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return false;
}

export function parsePublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP(S) URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new Error("Only standard HTTP(S) ports are allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".example") ||
    isPrivateOrReservedAddress(hostname)
  ) {
    throw new Error("Private or reserved hosts are not allowed");
  }

  url.hash = "";
  return url;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = parsePublicHttpUrl(raw);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
    throw new Error("URL resolves to a private or reserved address");
  }
  return url;
}

export async function fetchPublicUrl(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 3,
): Promise<Response> {
  let current = await assertPublicHttpUrl(raw);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location || redirectCount === maxRedirects) {
      throw new Error("Too many or invalid redirects");
    }
    const next = await assertPublicHttpUrl(new URL(location, current).toString());
    if (current.protocol === "https:" && next.protocol !== "https:") {
      throw new Error("HTTPS redirects cannot downgrade to HTTP");
    }
    current = next;
  }
  throw new Error("Too many redirects");
}

export function assertSameSiteUrl(raw: string, expected: URL): URL {
  const url = parsePublicHttpUrl(raw);
  const expectedHost = expected.hostname.toLowerCase();
  const actualHost = url.hostname.toLowerCase();
  if (actualHost !== expectedHost && !actualHost.endsWith(`.${expectedHost}`)) {
    throw new Error("Cross-site sitemap URL is not allowed");
  }
  return url;
}
