import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getGoogleAuth } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

interface LinkRow {
  site_name?: string;
  linking_domain: string;
  target_page: string;
  link_count: number;
}

function timingHeaders(startedAt: number) {
  const ms = Date.now() - startedAt;
  return { "X-Response-Time": `${ms}ms`, "Server-Timing": `app;dur=${ms}` };
}

function normalizeLink(row: Record<string, unknown>): LinkRow {
  return {
    site_name: row.site_name ? String(row.site_name) : undefined,
    linking_domain: String(row.linking_domain ?? ""),
    target_page: String(row.target_page ?? ""),
    link_count: Number(row.link_count ?? 0),
  };
}

async function loadPortfolioLinks(sql: ReturnType<typeof getSQL>): Promise<LinkRow[]> {
  const cached = (await sql`
    SELECT s.name AS site_name, gl.linking_domain, gl.target_page, SUM(gl.link_count) AS link_count
    FROM gsc_links gl
    JOIN sites s ON s.id = gl.site_id
    WHERE s.is_active = TRUE
    GROUP BY s.name, gl.linking_domain, gl.target_page
  `) as Record<string, unknown>[];

  const sitesWithoutCache = (await sql`
    SELECT s.id, s.name
    FROM sites s
    WHERE s.is_active = TRUE
      AND s.gsc_property IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gsc_links gl WHERE gl.site_id = s.id)
    ORDER BY s.name
  `) as Array<{ id: number; name: string }>;

  let fallback: Record<string, unknown>[] = [];
  if (sitesWithoutCache.length > 0) {
    fallback = (await sql`
      SELECT
        s.name AS site_name,
        'GSC visibility signal' AS linking_domain,
        scd.page AS target_page,
        SUM(scd.impressions) AS link_count
      FROM search_console_data scd
      JOIN sites s ON s.id = scd.site_id
      WHERE s.id = ANY(${sitesWithoutCache.map((s) => s.id)})
        AND scd.date >= CURRENT_DATE - INTERVAL '30 days'
        AND scd.page IS NOT NULL
        AND scd.page != ''
      GROUP BY s.name, scd.page
      ORDER BY SUM(scd.impressions) DESC
      LIMIT 100
    `) as Record<string, unknown>[];
  }

  return [...cached, ...fallback]
    .map(normalizeLink)
    .sort((a, b) => b.link_count - a.link_count)
    .slice(0, 100);
}

async function loadFallbackVisibility(sql: ReturnType<typeof getSQL>, siteId: number): Promise<LinkRow[]> {
  const rows = (await sql`
    SELECT page, SUM(impressions) AS impressions
    FROM search_console_data
    WHERE site_id = ${siteId}
      AND date >= NOW() - INTERVAL '30 days'
      AND page IS NOT NULL
      AND page != ''
    GROUP BY page
    ORDER BY SUM(impressions) DESC
    LIMIT 30
  `) as Array<{ page: string; impressions: string }>;

  return rows.map((row) => ({
    linking_domain: "GSC visibility signal",
    target_page: row.page,
    link_count: Number(row.impressions),
  }));
}

async function loadGoogleLinks(siteUrl: string): Promise<LinkRow[]> {
  const googleAuth = getGoogleAuth();
  const tokenResponse = await (googleAuth as { getAccessToken: () => Promise<{ token: string }> }).getAccessToken();
  const token = tokenResponse.token;
  const encodedSiteUrl = encodeURIComponent(siteUrl);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/links`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];

  const data = await res.json() as Record<string, unknown>;
  const linkToTarget = data.linkToTarget as { url?: string; linkedPages?: { url?: string; urlCount?: number }[] }[] | undefined;
  const links: LinkRow[] = [];
  for (const linking of linkToTarget ?? []) {
    for (const page of linking.linkedPages ?? []) {
      links.push({
        linking_domain: linking.url ?? "",
        target_page: page.url ?? "",
        link_count: Number(page.urlCount ?? 1),
      });
    }
  }
  return links;
}

async function persistLinks(sql: ReturnType<typeof getSQL>, siteId: number, links: LinkRow[]): Promise<void> {
  if (links.length === 0) return;
  try {
    await sql`DELETE FROM gsc_links WHERE site_id = ${siteId}`;
    for (const link of links.slice(0, 100)) {
      await sql`
        INSERT INTO gsc_links (site_id, linking_domain, target_page, link_count)
        VALUES (${siteId}, ${link.linking_domain}, ${link.target_page}, ${link.link_count})
      `;
    }
  } catch {
    // Non-blocking cache write.
  }
}

function buildResponse(links: LinkRow[], source: string) {
  const totalDomains = new Set(links.map((l) => l.linking_domain)).size;
  const totalLinks = links.reduce((s, l) => s + l.link_count, 0);
  const authorityScore = Math.min(100, Math.round(Math.log1p(totalLinks) * 10 + totalDomains * 2));
  const fallbackOnly = links.length > 0 && links.every((l) => l.linking_domain === "GSC visibility signal");

  return {
    links,
    totalDomains,
    totalLinks,
    authorityScore,
    source,
    sourceLabel: fallbackOnly ? "Signal de visibilite GSC (fallback)" : "Backlinks GSC + cache local",
    scoreLabel: fallbackOnly ? "Score visibilite estime" : "Score autorite",
    warning: fallbackOnly
      ? "Fallback: Search Console Links API/export indisponible. Les lignes montrent les pages visibles dans GSC, pas des domaines backlinks verifies."
      : undefined,
  };
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const siteIdRaw = searchParams.get("site_id");
    if (!siteIdRaw) return NextResponse.json({ error: "site_id required" }, { status: 400 });

    const sql = getSQL();
    if (siteIdRaw === "all") {
      const links = await loadPortfolioLinks(sql);
      return NextResponse.json(
        buildResponse(links, "portfolio_cache_plus_gsc_visibility"),
        { headers: timingHeaders(startedAt) },
      );
    }

    const siteId = parseInt(siteIdRaw, 10);
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "site_id invalid" }, { status: 400 });

    const sites = (await sql`SELECT * FROM sites WHERE id = ${siteId} LIMIT 1`) as Array<Record<string, unknown>>;
    if (sites.length === 0) return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const siteUrl = sites[0].gsc_property as string | null;
    if (!siteUrl) return NextResponse.json({ error: "No GSC property configured" }, { status: 400 });

    let source = "gsc_links_api";
    let links: LinkRow[] = [];
    try {
      links = await loadGoogleLinks(siteUrl);
    } catch {
      links = [];
    }

    if (links.length === 0) {
      source = "gsc_visibility_fallback";
      links = await loadFallbackVisibility(sql, siteId);
    }
    await persistLinks(sql, siteId, links);

    return NextResponse.json(
      buildResponse(links.slice(0, 50), source),
      { headers: timingHeaders(startedAt) },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
