/**
 * Daily indexation queue processor — runs 08:00 UTC (10:00 Paris, 1h after Pacific midnight quota reset).
 *
 * Logic:
 * 1. For each active site, parse its sitemap.xml and collect URLs.
 * 2. Prioritize URLs not yet submitted in the last 30 days (via indexation_log table).
 * 3. Sort by lastmod desc (newest first).
 * 4. Submit batch of up to MAX_PER_RUN URLs via Google Indexing API URL_UPDATED.
 * 5. Log each submission to indexation_log (url, status_code, submitted_at).
 * 6. Stop early on 429 (quota exceeded).
 *
 * Idempotent: indexation_log dedupes URLs across runs (no resubmit within 30d).
 * Auth: requireCronOrUser (Vercel cron secret OR dashboard user session).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";
import { JWT } from "google-auth-library";

const MAX_PER_RUN = 180; // Reserve buffer under 200/day default quota
const RESUBMIT_DAYS = 30; // Don't resubmit same URL within this window
const THROTTLE_MS = 600;  // 100 req/min max

interface Site {
  id: number;
  url: string;
  gsc_property: string | null;
}

interface SitemapURL {
  loc: string;
  lastmod: string | null;
  site_id: number;
}

interface SubmissionResult {
  url: string;
  status: number;
  ok: boolean;
  error?: string;
}

function parseGSCCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (parsed.client_email && parsed.private_key) {
      return { client_email: parsed.client_email, private_key: parsed.private_key };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchSitemapURLs(siteUrl: string): Promise<Array<{ loc: string; lastmod: string | null }>> {
  const candidates = [`${siteUrl.replace(/\/$/, "")}/sitemap.xml`, `${siteUrl.replace(/\/$/, "")}/sitemap_index.xml`];
  for (const sm of candidates) {
    try {
      const res = await fetch(sm, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const xml = await res.text();
      // If this is an index, expand children
      if (/<sitemapindex/i.test(xml)) {
        const childUrls = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g)).map((m) => m[1]);
        const all: Array<{ loc: string; lastmod: string | null }> = [];
        for (const child of childUrls.slice(0, 10)) {
          try {
            const cr = await fetch(child, { signal: AbortSignal.timeout(15000) });
            if (!cr.ok) continue;
            const cxml = await cr.text();
            all.push(...parseUrlset(cxml));
          } catch { /* skip child */ }
        }
        return all;
      }
      return parseUrlset(xml);
    } catch { /* try next */ }
  }
  return [];
}

function parseUrlset(xml: string): Array<{ loc: string; lastmod: string | null }> {
  const urls: Array<{ loc: string; lastmod: string | null }> = [];
  const re = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const locMatch = /<loc>(.*?)<\/loc>/.exec(block);
    const lastmodMatch = /<lastmod>(.*?)<\/lastmod>/.exec(block);
    if (locMatch) urls.push({ loc: locMatch[1].trim(), lastmod: lastmodMatch?.[1]?.trim() ?? null });
  }
  return urls;
}

async function submitIndexingAPI(token: string, url: string): Promise<SubmissionResult> {
  try {
    const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, type: "URL_UPDATED" }),
      signal: AbortSignal.timeout(15000),
    });
    const ok = res.ok;
    const status = res.status;
    let errorText: string | undefined;
    if (!ok) {
      const body = await res.text();
      errorText = body.slice(0, 300);
    }
    return { url, status, ok, error: errorText };
  } catch (e) {
    return { url, status: 0, ok: false, error: e instanceof Error ? e.message : "fetch error" };
  }
}

async function ensureIndexationLogTable(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS indexation_log (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      site_id INTEGER,
      status_code INTEGER,
      ok BOOLEAN,
      error TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_indexation_log_url_submitted ON indexation_log (url, submitted_at)`;
}

export async function GET(request: Request) {
  const authResult = await requireCronOrUser(request);
  if (authResult) return authResult;

  const sql = getSQL();
  const startedAt = new Date();

  try {
    await ensureIndexationLogTable(sql);

    const creds = parseGSCCredentials();
    if (!creds) {
      return NextResponse.json({
        success: false,
        error: "GSC_SERVICE_ACCOUNT_JSON env var missing or invalid",
      }, { status: 500 });
    }

    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/indexing"],
    });
    const tokenResponse = await auth.getAccessToken();
    const token = tokenResponse.token;
    if (!token) {
      return NextResponse.json({ success: false, error: "Failed to obtain access token" }, { status: 500 });
    }

    const sites = (await sql`
      SELECT id, url, gsc_property FROM sites WHERE is_active = true ORDER BY id
    `) as Site[];

    // Collect URLs from each site
    const allUrls: SitemapURL[] = [];
    for (const site of sites) {
      try {
        const urls = await fetchSitemapURLs(site.url);
        for (const u of urls) {
          allUrls.push({ loc: u.loc, lastmod: u.lastmod, site_id: site.id });
        }
      } catch { /* skip site */ }
    }

    // Dedupe URLs already submitted in last 30 days
    const recentRows = (await sql`
      SELECT DISTINCT url FROM indexation_log
      WHERE ok = true AND submitted_at >= NOW() - (${RESUBMIT_DAYS} || ' days')::interval
    `) as Array<{ url: string }>;
    const recentSet = new Set(recentRows.map((r) => r.url));

    const candidates = allUrls
      .filter((u) => !recentSet.has(u.loc))
      .sort((a, b) => {
        // Sort by lastmod desc (newest first)
        if (!a.lastmod && !b.lastmod) return 0;
        if (!a.lastmod) return 1;
        if (!b.lastmod) return -1;
        return b.lastmod.localeCompare(a.lastmod);
      })
      .slice(0, MAX_PER_RUN);

    const results: SubmissionResult[] = [];
    let quotaHit = false;
    for (const c of candidates) {
      const r = await submitIndexingAPI(token, c.loc);
      results.push(r);
      // Persist log
      await sql`
        INSERT INTO indexation_log (url, site_id, status_code, ok, error)
        VALUES (${c.loc}, ${c.site_id}, ${r.status}, ${r.ok}, ${r.error ?? null})
      `;
      if (r.status === 429) {
        quotaHit = true;
        break;
      }
      // Throttle
      await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS));
    }

    const successful = results.filter((r) => r.ok).length;
    const failed = results.length - successful;
    const durationMs = Date.now() - startedAt.getTime();

    return NextResponse.json({
      success: true,
      sitemaps_processed: sites.length,
      urls_discovered: allUrls.length,
      candidates_after_dedup: candidates.length,
      submitted: results.length,
      successful,
      failed,
      quota_hit: quotaHit,
      duration_ms: durationMs,
      timestamp: startedAt.toISOString(),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
