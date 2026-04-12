import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getGoogleAuth } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id");

    if (!siteId) return NextResponse.json({ error: "site_id required" }, { status: 400 });

    const sql = getSQL();
    const sites = await sql`SELECT * FROM sites WHERE id = ${parseInt(siteId, 10)} LIMIT 1`;

    if (!sites.length) return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const site = sites[0] as Record<string, unknown>;
    const siteUrl = site.gsc_property as string;

    if (!siteUrl) return NextResponse.json({ error: "No GSC property configured" }, { status: 400 });

    let links: { linking_domain: string; target_page: string; link_count: number }[] = [];
    let source = "gsc_links_api";

    try {
      const googleAuth = getGoogleAuth();
      const tokenResponse = await (googleAuth as { getAccessToken: () => Promise<{ token: string }> }).getAccessToken();
      const token = tokenResponse.token;

      const encodedSiteUrl = encodeURIComponent(siteUrl);
      const res = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/links`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const linkToTarget = data.linkToTarget as { url?: string; linkedPages?: { url?: string; urlCount?: number }[] }[] | undefined;

        if (linkToTarget && Array.isArray(linkToTarget)) {
          for (const linking of linkToTarget) {
            const domain = linking.url ?? "";
            for (const page of linking.linkedPages ?? []) {
              links.push({
                linking_domain: domain,
                target_page: page.url ?? "",
                link_count: Number(page.urlCount ?? 1),
              });
            }
          }
        }
      } else {
        source = "gsc_impressions_fallback";
      }
    } catch {
      source = "gsc_impressions_fallback";
    }

    // Fallback: top pages by impressions as proxy
    if (links.length === 0) {
      source = "gsc_impressions_fallback";
      const rows = await sql`
        SELECT page, SUM(impressions) as impressions, SUM(clicks) as clicks
        FROM search_console_data
        WHERE site_id = ${parseInt(siteId, 10)}
          AND date >= NOW() - INTERVAL '30 days'
          AND page IS NOT NULL AND page != ''
        GROUP BY page
        ORDER BY SUM(impressions) DESC
        LIMIT 30
      `;

      links = (rows as Record<string, unknown>[]).map((row) => ({
        linking_domain: "Données GSC (impressions)",
        target_page: row.page as string,
        link_count: Number(row.impressions),
      }));
    }

    // Persist to DB
    if (links.length > 0) {
      try {
        await sql`DELETE FROM gsc_links WHERE site_id = ${parseInt(siteId, 10)}`;
        for (const link of links.slice(0, 100)) {
          await sql`
            INSERT INTO gsc_links (site_id, linking_domain, target_page, link_count)
            VALUES (${parseInt(siteId, 10)}, ${link.linking_domain}, ${link.target_page}, ${link.link_count})
          `;
        }
      } catch {
        // Non-blocking
      }
    }

    const totalDomains = new Set(links.map((l) => l.linking_domain)).size;
    const totalLinks = links.reduce((s, l) => s + l.link_count, 0);
    const authorityScore = Math.min(100, Math.round(Math.log1p(totalLinks) * 10 + totalDomains * 2));

    return NextResponse.json({
      links: links.slice(0, 50),
      totalDomains,
      totalLinks,
      authorityScore,
      source,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
