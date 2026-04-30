import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";

interface SchemaResult {
  url: string;
  types: string[];
  errors: string[];
  warnings: string[];
  rawJson: string | null;
  status: "ok" | "warn" | "error" | "no-schema";
}

const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

function parseJsonLd(html: string): { types: string[]; errors: string[]; warnings: string[]; raw: string | null } {
  const types: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let rawJson: string | null = null;

  let match: RegExpExecArray | null;
  JSON_LD_RE.lastIndex = 0;
  while ((match = JSON_LD_RE.exec(html)) !== null) {
    const raw = match[1].trim();
    rawJson = raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (typeof item !== "object" || item === null) {
          errors.push("JSON-LD item is not an object");
          continue;
        }
        const obj = item as Record<string, unknown>;
        const type = obj["@type"];
        if (!type) {
          errors.push("Missing @type in JSON-LD");
        } else {
          types.push(String(type));
        }
        if (
          (type === "Article" || type === "BlogPosting" || type === "NewsArticle") &&
          !obj["datePublished"]
        ) {
          warnings.push("Article: missing datePublished");
        }
        if (!obj["name"] && !obj["headline"]) {
          warnings.push("Missing name/headline");
        }
      }
    } catch {
      errors.push("Invalid JSON in JSON-LD block");
    }
  }

  return { types, errors, warnings, raw: rawJson };
}

async function fetchWithTimeout(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "SEO-Dashboard-Auditor/1.0" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  const sitemapUrl = siteUrl.replace(/\/$/, "") + "/sitemap.xml";
  const html = await fetchWithTimeout(sitemapUrl);
  if (!html) return [];
  const matches = html.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi);
  const urls: string[] = [];
  for (const m of matches) {
    urls.push(m[1].trim());
    if (urls.length >= 50) break;
  }
  return urls;
}

export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let siteUrl: string;
  try {
    const body = await request.json() as { siteUrl?: unknown };
    if (typeof body.siteUrl !== "string") {
      return NextResponse.json({ error: "siteUrl required" }, { status: 400 });
    }
    siteUrl = body.siteUrl;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const urls = await fetchSitemapUrls(siteUrl);
  if (urls.length === 0) {
    return NextResponse.json({ error: "Sitemap introuvable ou vide" }, { status: 404 });
  }

  const results: SchemaResult[] = [];

  for (const url of urls) {
    const html = await fetchWithTimeout(url);
    if (!html) {
      results.push({ url, types: [], errors: ["Fetch failed"], warnings: [], rawJson: null, status: "error" });
      continue;
    }

    const { types, errors, warnings, raw } = parseJsonLd(html);

    let status: SchemaResult["status"] = "no-schema";
    if (types.length > 0) {
      status = errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok";
    } else if (errors.length > 0) {
      status = "error";
    }

    results.push({ url, types, errors, warnings, rawJson: raw, status });
  }

  const withSchema = results.filter((r) => r.types.length > 0).length;
  const score = results.length > 0 ? Math.round((withSchema / results.length) * 100) : 0;

  return NextResponse.json({ results, score, total: results.length, withSchema });
}
