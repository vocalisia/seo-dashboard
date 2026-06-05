import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { testRichResults } from "@/lib/rich-results";
import { ensureSchema } from "@/lib/db";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SchemaResult {
  url: string;
  types: string[];
  errors: string[];
  warnings: string[];
  rawJson: string | null;
  status: "ok" | "warn" | "error" | "no-schema";
  google_verified?: boolean;
  google_types?: string[];
  google_errors?: string[];
  google_warnings?: string[];
  google_verdict?: string;
  google_discrepancies?: string[];
}

const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

function parseJsonLd(html: string): { types: string[]; errors: string[]; warnings: string[]; raw: string | null } {
  const types: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let rawJson: string | null = null;

  let match: RegExpExecArray | null;
  JSON_LD_RE.lastIndex = 0;

  function walkGraph(items: unknown[]): unknown[] {
    // Expand @graph blocks into a flat list of nodes
    const expanded: unknown[] = [];
    for (const it of items) {
      if (typeof it === "object" && it !== null) {
        const g = (it as Record<string, unknown>)["@graph"];
        if (Array.isArray(g)) {
          expanded.push(...g);
          continue;
        }
      }
      expanded.push(it);
    }
    return expanded;
  }

  while ((match = JSON_LD_RE.exec(html)) !== null) {
    const raw = match[1].trim();
    rawJson = raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      const items = walkGraph(Array.isArray(parsed) ? parsed : [parsed]);
      for (const item of items) {
        if (typeof item !== "object" || item === null) {
          errors.push("JSON-LD item is not an object");
          continue;
        }
        const obj = item as Record<string, unknown>;
        const rawType = obj["@type"];
        if (!rawType) {
          errors.push("Missing @type in JSON-LD");
          continue;
        }
        const type = String(rawType);
        types.push(type);

        const isArticle = ["Article", "BlogPosting", "NewsArticle", "TechArticle"].includes(type);
        const isProduct = type === "Product";
        const isOrg = ["Organization", "Corporation", "LocalBusiness"].includes(type);
        const isFAQ = type === "FAQPage";
        const isHowTo = type === "HowTo";
        const isWebSite = type === "WebSite";

        // Generic name/headline check — skip for structural types that don't need it
        const STRUCTURAL_TYPES = ["FAQPage", "BreadcrumbList", "ItemList", "Person", "WebPage"];
        if (!STRUCTURAL_TYPES.includes(type) && !obj["name"] && !obj["headline"]) {
          warnings.push(`${type}: missing name/headline`);
        }

        // Article validation (Google Rich Results requirements)
        if (isArticle) {
          if (!obj["datePublished"]) warnings.push(`${type}: missing datePublished`);
          if (!obj["author"]) warnings.push(`${type}: missing author`);
          if (!obj["image"]) warnings.push(`${type}: missing image`);
          if (!obj["headline"]) warnings.push(`${type}: missing headline`);
          if (!obj["publisher"]) warnings.push(`${type}: missing publisher`);
          if (obj["headline"] && String(obj["headline"]).length > 110) {
            warnings.push(`${type}: headline > 110 chars (Google truncates)`);
          }
        }

        // Product validation
        if (isProduct) {
          if (!obj["image"]) warnings.push("Product: missing image");
          if (!obj["offers"] && !obj["aggregateRating"] && !obj["review"]) {
            warnings.push("Product: needs offers, aggregateRating, or review for rich result");
          }
          if (!obj["description"]) warnings.push("Product: missing description");
        }

        // Organization validation
        if (isOrg) {
          if (!obj["url"]) warnings.push(`${type}: missing url`);
          if (!obj["logo"]) warnings.push(`${type}: missing logo`);
        }

        // FAQ validation
        if (isFAQ) {
          const main = obj["mainEntity"];
          if (!Array.isArray(main) || main.length === 0) {
            errors.push("FAQPage: mainEntity must be an array of Questions");
          } else if (main.length < 2) {
            warnings.push("FAQPage: only 1 Question (recommend 3+)");
          }
        }

        // HowTo validation
        if (isHowTo) {
          if (!obj["step"]) errors.push("HowTo: missing step");
          if (!obj["totalTime"]) warnings.push("HowTo: missing totalTime");
        }

        // WebSite validation
        if (isWebSite) {
          if (!obj["url"]) warnings.push("WebSite: missing url");
          if (!obj["potentialAction"]) {
            warnings.push("WebSite: missing potentialAction (SearchAction for sitelinks searchbox)");
          }
        }

        // Generic url validation
        if (obj["url"] && typeof obj["url"] === "string") {
          if (!/^https?:\/\//.test(obj["url"] as string)) {
            errors.push(`${type}: url is not absolute (${(obj["url"] as string).slice(0, 50)})`);
          }
        }

        // inLanguage check (multilingual sites)
        if ((isArticle || isWebSite) && !obj["inLanguage"]) {
          warnings.push(`${type}: missing inLanguage (recommended for i18n)`);
        }
      }
    } catch {
      errors.push("Invalid JSON in JSON-LD block");
    }
  }

  return { types, errors, warnings, raw: rawJson };
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "SEO-Dashboard-Auditor/1.0" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(siteUrl: string, limit: number): Promise<string[]> {
  const sitemapUrl = siteUrl.replace(/\/$/, "") + "/sitemap.xml";
  const html = await fetchWithTimeout(sitemapUrl);
  if (!html) return [];
  const matches = html.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi);
  const urls: string[] = [];
  for (const m of matches) {
    urls.push(m[1].trim());
    if (urls.length >= limit) break;
  }
  return urls;
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let siteUrl: string;
  let verifyWithGoogle = false;
  let maxVerify = 10;
  let maxUrls = 30;
  const startedAt = Date.now();
  try {
    const body = (await request.json()) as {
      siteUrl?: unknown;
      verifyWithGoogle?: unknown;
      maxVerify?: unknown;
      maxUrls?: unknown;
    };
    if (typeof body.siteUrl !== "string") {
      return NextResponse.json({ error: "siteUrl required" }, { status: 400 });
    }
    siteUrl = body.siteUrl;
    if (typeof body.verifyWithGoogle === "boolean") verifyWithGoogle = body.verifyWithGoogle;
    if (typeof body.maxVerify === "number" && body.maxVerify > 0) {
      maxVerify = Math.min(10, Math.floor(body.maxVerify));
    }
    if (typeof body.maxUrls === "number" && body.maxUrls > 0) {
      maxUrls = Math.min(50, Math.floor(body.maxUrls));
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Best-effort migration so rich_results_cache exists before write.
  if (verifyWithGoogle) {
    try { await ensureSchema(); } catch (e) { logError("schema-audit.ensureSchema", e); }
  }

  const urls = await fetchSitemapUrls(siteUrl, maxUrls);
  if (urls.length === 0) {
    return NextResponse.json({ error: "Sitemap introuvable ou vide" }, { status: 404 });
  }

  const results = await mapLimit(urls, 6, async (url): Promise<SchemaResult> => {
    const html = await fetchWithTimeout(url);
    if (!html) {
      return { url, types: [], errors: ["Fetch failed"], warnings: [], rawJson: null, status: "error" };
    }

    const { types, errors, warnings, raw } = parseJsonLd(html);

    let status: SchemaResult["status"] = "no-schema";
    if (types.length > 0) {
      status = errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok";
    } else if (errors.length > 0) {
      status = "error";
    }

    return { url, types, errors, warnings, rawJson: raw, status };
  });

  // Optional: verify first N pages via Google Rich Results API.
  if (verifyWithGoogle) {
    const toVerify = results
      .filter((r) => r.types.length > 0)
      .slice(0, maxVerify);

    await mapLimit(toVerify, 2, async (r) => {
      const gr = await testRichResults(r.url);
      r.google_verified = gr.google_verified;
      r.google_types = gr.detected_types;
      r.google_errors = gr.errors;
      r.google_warnings = gr.warnings;
      r.google_verdict = gr.verdict;

      const discrepancies: string[] = [];
      const localSet = new Set(r.types.map((t) => t.toLowerCase()));
      const googleSet = new Set(gr.detected_types.map((t) => t.toLowerCase()));
      for (const t of localSet) {
        if (!googleSet.has(t)) discrepancies.push(`local-only: ${t}`);
      }
      for (const t of googleSet) {
        if (!localSet.has(t)) discrepancies.push(`google-only: ${t}`);
      }
      r.google_discrepancies = discrepancies;
      return r;
    });
  }

  const withSchema = results.filter((r) => r.types.length > 0).length;
  const score = results.length > 0 ? Math.round((withSchema / results.length) * 100) : 0;
  const googleVerifiedCount = results.filter((r) => r.google_verified).length;

  return NextResponse.json({
    success: true,
    results,
    score,
    total: results.length,
    withSchema,
    googleVerifiedCount,
    verifiedWithGoogle: verifyWithGoogle,
    partial: urls.length >= maxUrls,
    duration_ms: Date.now() - startedAt,
  });
}
