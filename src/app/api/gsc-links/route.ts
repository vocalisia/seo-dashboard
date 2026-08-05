import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getGoogleAuth } from "@/lib/google-auth";
import { isVerifiedBacklinkRow } from "@/lib/backlink-data";

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

  return cached
    .map(normalizeLink)
    .filter(isVerifiedBacklinkRow)
    .sort((a, b) => b.link_count - a.link_count)
    .slice(0, 100);
}

async function loadSiteCachedLinks(sql: ReturnType<typeof getSQL>, siteId: number): Promise<LinkRow[]> {
  const rows = (await sql`
    SELECT linking_domain, target_page, SUM(link_count) AS link_count
    FROM gsc_links
    WHERE site_id = ${siteId}
    GROUP BY linking_domain, target_page
    ORDER BY SUM(link_count) DESC
    LIMIT 50
  `) as Record<string, unknown>[];

  return rows.map(normalizeLink).filter(isVerifiedBacklinkRow);
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

    const cachedLinks = await loadSiteCachedLinks(sql, siteId);
    if (cachedLinks.length > 0 && searchParams.get("refresh") !== "1") {
      return NextResponse.json(
        buildResponse(cachedLinks, "local_cache"),
        { headers: timingHeaders(startedAt) },
      );
    }

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
      return NextResponse.json(
        {
          error: "Aucune donnée de backlinks vérifiée. Importez un export GSC Links ou connectez une source de liens autorisée.",
          data_status: "unavailable",
          links: [],
        },
        { status: 424, headers: timingHeaders(startedAt) },
      );
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
