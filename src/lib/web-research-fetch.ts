import * as http from "node:http";
import * as https from "node:https";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { parsePublicHttpUrl } from "@/lib/safe-url";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RESERVED_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan", ".test", ".invalid", ".example"];

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function blockedIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) return true;
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

function expandIpv6(address: string): number[] | null {
  let normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (normalized.includes(".")) {
    const colon = normalized.lastIndexOf(":");
    const ipv4 = parseIpv4(normalized.slice(colon + 1));
    if (colon < 0 || !ipv4) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    normalized = `${normalized.slice(0, colon)}:${high}:${low}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const raw = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (raw.length !== 8 || raw.some((group) => !/^[0-9a-f]{1,4}$/i.test(group || "0"))) return null;
  return raw.map((group) => Number.parseInt(group || "0", 16));
}

function mappedIpv4(groups: number[]): string | null {
  if (!groups.slice(0, 5).every((group) => group === 0) || groups[5] !== 0xffff) return null;
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
}

export function isResearchBlockedAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return blockedIpv4(normalized);
  if (family !== 6) return true;
  const groups = expandIpv6(normalized);
  if (!groups) return true;
  const mapped = mappedIpv4(groups);
  if (mapped) return blockedIpv4(mapped);
  const [a, b, c, d, e, f, g, h] = groups;
  return (
    groups.every((group) => group === 0) ||
    (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g === 0 && h === 1) ||
    (a & 0xfe00) === 0xfc00 ||
    (a & 0xffc0) === 0xfe80 ||
    (a & 0xff00) === 0xff00 ||
    (a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) ||
    (a === 0x0100 && b === 0 && c === 0 && d === 0) ||
    (a === 0x2001 && [0x0000, 0x0002, 0x0010, 0x0db8].includes(b)) ||
    a === 0x2002
  );
}

export function parseResearchPublicUrl(raw: string): URL {
  const url = parsePublicHttpUrl(raw);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname.includes(".") || isIP(hostname) !== 0 || RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("Research only accepts public DNS hostnames");
  }
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new Error("Research only accepts standard web ports");
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

type Resolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

export async function resolveResearchUrl(
  raw: string,
  resolver: Resolver = lookup,
): Promise<{ url: URL; addresses: LookupAddress[] }> {
  const url = parseResearchPublicUrl(raw);
  const addresses = await resolver(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address, family }) =>
    (family !== 4 && family !== 6) || isResearchBlockedAddress(address)
  )) {
    throw new Error("Research URL resolves to a private or reserved address");
  }
  return { url, addresses };
}

export function createResearchPinnedLookup(selected: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: selected.address, family: selected.family }]);
    else callback(null, selected.address, selected.family);
  };
}

function comparableAddress(address: string): string {
  const normalized = address.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const groups = isIP(normalized) === 6 ? expandIpv6(normalized) : null;
  return groups
    ? mappedIpv4(groups) ?? groups.map((group) => group.toString(16).padStart(4, "0")).join(":")
    : normalized;
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) normalized[key] = value.join(", ");
    else if (typeof value === "string") normalized[key] = value;
  }
  return normalized;
}

interface ResearchFetchOptions {
  headers?: HeadersInit;
  signal?: AbortSignal | null;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface ResearchFetchResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  text: string;
  remote_address: string;
}

async function requestPinned(
  url: URL,
  selected: LookupAddress,
  options: Required<Pick<ResearchFetchOptions, "timeoutMs" | "maxBytes">> & ResearchFetchOptions,
): Promise<Omit<ResearchFetchResponse, "url">> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const requestHeaders = new Headers(options.headers);
    if (!requestHeaders.has("user-agent")) requestHeaders.set("user-agent", "SEO-Dashboard-Research/1.0");
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "GET",
      headers: Object.fromEntries(requestHeaders.entries()),
      lookup: createResearchPinnedLookup(selected),
      agent: false,
    }, (response) => {
      const remoteAddress = response.socket.remoteAddress ?? "";
      if (comparableAddress(remoteAddress) !== comparableAddress(selected.address)) {
        response.destroy();
        fail(new Error("Research connection did not use the validated DNS address"));
        return;
      }
      const status = response.statusCode ?? 0;
      const headers = normalizeHeaders(response.headers);
      if (REDIRECT_STATUSES.has(status)) {
        response.resume();
        settled = true;
        resolve({ status, headers, text: "", remote_address: remoteAddress });
        return;
      }
      const declared = Number(response.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        response.destroy();
        fail(new Error("Research response exceeds the allowed size"));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > options.maxBytes) {
          response.destroy();
          fail(new Error("Research response exceeds the allowed size"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status,
          headers,
          text: Buffer.concat(chunks).toString("utf8"),
          remote_address: remoteAddress,
        });
      });
      response.on("error", fail);
    });
    const timeout = setTimeout(() => request.destroy(new Error("Research request timed out")), options.timeoutMs);
    request.once("close", () => clearTimeout(timeout));
    request.once("error", fail);
    if (options.signal) {
      if (options.signal.aborted) request.destroy(new Error("Research request aborted"));
      else options.signal.addEventListener("abort", () => request.destroy(new Error("Research request aborted")), { once: true });
    }
    request.end();
  });
}

export async function fetchResearchText(
  raw: string,
  options: ResearchFetchOptions = {},
): Promise<ResearchFetchResponse> {
  const maxRedirects = Math.max(0, Math.min(5, options.maxRedirects ?? 3));
  const normalizedOptions = {
    ...options,
    timeoutMs: Math.max(1_000, Math.min(30_000, options.timeoutMs ?? 10_000)),
    maxBytes: Math.max(1_024, Math.min(2_000_000, options.maxBytes ?? 500_000)),
  };
  let current = parseResearchPublicUrl(raw);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const resolved = await resolveResearchUrl(current.toString());
    const response = await requestPinned(resolved.url, resolved.addresses[0], normalizedOptions);
    if (!REDIRECT_STATUSES.has(response.status)) return { ...response, url: resolved.url.toString() };
    const location = response.headers.location;
    if (!location || redirects === maxRedirects) throw new Error("Too many or invalid research redirects");
    const next = parseResearchPublicUrl(new URL(location, resolved.url).toString());
    if (resolved.url.protocol === "https:" && next.protocol !== "https:") {
      throw new Error("Research redirects cannot downgrade HTTPS");
    }
    current = next;
  }
  throw new Error("Too many research redirects");
}
