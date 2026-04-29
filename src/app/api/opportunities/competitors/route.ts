export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { fetchGoogleSerpSnapshot } from "@/lib/opportunity-sources";
import { requireApiSession } from "@/lib/api-auth";

async function fetchBingResultUrls(query: string): Promise<string[]> {
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=fr`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const urls: string[] = [];
    for (const m of html.matchAll(/<h2[^>]*><a[^>]+href="([^"]+)"/g)) {
      try {
        const u = new URL(m[1]);
        if (!u.hostname.includes("bing.com") && !u.hostname.includes("microsoft.com")) {
          urls.push(u.toString());
        }
      } catch { /* skip */ }
    }
    return urls.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchDuckDuckGoResultUrls(query: string): Promise<string[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=fr-fr`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const urls: string[] = [];
    for (const m of html.matchAll(/uddg=([^&"]+)/g)) {
      try {
        const decoded = decodeURIComponent(m[1]);
        if (decoded.startsWith("http")) urls.push(decoded);
      } catch { /* skip */ }
    }
    return Array.from(new Set(urls)).slice(0, 10);
  } catch {
    return [];
  }
}

interface Competitor {
  url: string;
  name: string;
}

function urlToCompetitor(url: string): Competitor | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "");
    if (
      host.includes("google.") ||
      host.endsWith("youtube.com") ||
      host.endsWith("youtu.be") ||
      host.endsWith("gstatic.com")
    ) return null;
    return { url, name: host };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: { opportunity_id?: number };
  try {
    body = (await req.json()) as { opportunity_id?: number };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const oppId = body.opportunity_id;
  if (!oppId) return NextResponse.json({ success: false, error: "opportunity_id required" }, { status: 400 });

  const sql = getSQL();
  try {
    const rows = await sql`SELECT id, niche, core_keywords FROM market_opportunities WHERE id = ${oppId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    const opp = rows[0] as { id: number; niche: string; core_keywords: unknown };

    const keywords = Array.isArray(opp.core_keywords)
      ? (opp.core_keywords as string[])
      : (typeof opp.core_keywords === "string"
          ? (() => { try { return JSON.parse(opp.core_keywords as string) as string[]; } catch { return []; } })()
          : []);

    const queries = [opp.niche, ...keywords.slice(0, 2)].filter(Boolean).slice(0, 3);

    const allUrls: string[] = [];
    for (const q of queries) {
      const [google, bing, ddg] = await Promise.all([
        fetchGoogleSerpSnapshot(q),
        fetchBingResultUrls(q),
        fetchDuckDuckGoResultUrls(q),
      ]);
      allUrls.push(...(google.resultUrls ?? []), ...bing, ...ddg);
      if (allUrls.length >= 30) break;
    }

    const seenHosts = new Set<string>();
    const competitors: Competitor[] = [];
    for (const url of allUrls) {
      const c = urlToCompetitor(url);
      if (!c) continue;
      if (seenHosts.has(c.name)) continue;
      seenHosts.add(c.name);
      competitors.push(c);
      if (competitors.length >= 8) break;
    }

    if (competitors.length > 0) {
      try {
        await sql`
          UPDATE market_opportunities
          SET competitors = ${JSON.stringify(competitors)}
          WHERE id = ${oppId}
        `;
      } catch {
        // best-effort persistence
      }
    }

    return NextResponse.json({ success: true, competitors, queries });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
