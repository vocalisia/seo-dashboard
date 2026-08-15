import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const INFO_PATTERNS = /\b(comment|pourquoi|qu(?:'|´|`)?est[\s-]?ce|what|how|why|when|where|guide|exemple|example|tutorial|tutoriel|définition|definition|signification|meaning)\b/i;

const CTR_BENCHMARK: Record<number, number> = {
  1: 0.286, 2: 0.157, 3: 0.094, 4: 0.064, 5: 0.049,
  6: 0.038, 7: 0.030, 8: 0.024, 9: 0.020, 10: 0.017,
};

interface AioRow {
  query: string;
  page: unknown;
  site_id: unknown;
  site_name: unknown;
  clicks: unknown;
  impressions: unknown;
  position: unknown;
}

interface AioSummary {
  site_id: number;
  site_name: string | null;
  candidates: number;
  probable: number;
  watch: number;
  missed_clicks: number;
}

interface AioCoverage extends AioSummary {
  checked: boolean;
}

function clampDays(value: string | null): number {
  const days = Number.parseInt(value || "28", 10);
  return Number.isFinite(days) ? Math.max(7, Math.min(180, days)) : 28;
}

function clampLimit(value: string | null): number {
  const limit = Number.parseInt(value || "100", 10);
  return Number.isFinite(limit) ? Math.max(1, Math.min(1000, limit)) : 100;
}

function updateSummary(map: Map<number, AioSummary>, row: {
  siteId: number | null;
  siteName: string | null;
  missedClicks: number;
  confidence: "probable" | "watch";
}): void {
  if (row.siteId === null) return;
  const existing = map.get(row.siteId) ?? {
    site_id: row.siteId,
    site_name: row.siteName,
    candidates: 0,
    probable: 0,
    watch: 0,
    missed_clicks: 0,
  };
  existing.candidates += 1;
  existing.missed_clicks += row.missedClicks;
  if (row.confidence === "probable") existing.probable += 1;
  else existing.watch += 1;
  map.set(row.siteId, existing);
}

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteId = request.nextUrl.searchParams.get("siteId");
  const days = clampDays(request.nextUrl.searchParams.get("days"));
  const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
  const includeWatch = request.nextUrl.searchParams.get("include_watch") !== "0";

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  if (isLocalDevDemoMode()) {
    return NextResponse.json({ rows: [], summary: [], scanned: 0, days, siteId });
  }

  const parsedSiteId = siteId === "all" ? null : Number.parseInt(siteId, 10);
  if (siteId !== "all" && !Number.isFinite(parsedSiteId)) {
    return NextResponse.json({ error: "siteId invalid" }, { status: 400 });
  }

  try {
    const sql = getSQL();
    const isAll = siteId === "all";
    const activeSites = isAll
      ? (await sql`
        SELECT id AS site_id, name AS site_name
        FROM sites
        WHERE is_active = true
        ORDER BY name ASC
      `) as Array<{ site_id: unknown; site_name: unknown }>
      : [];

    const rows = isAll
      ? await sql`
        SELECT
          d.query,
          d.page,
          d.site_id,
          s.name AS site_name,
          SUM(d.clicks) AS clicks,
          SUM(d.impressions) AS impressions,
          SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0) AS position
        FROM search_console_data d
        LEFT JOIN sites s ON s.id = d.site_id
        WHERE d.date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
          AND d.query IS NOT NULL
          AND d.page IS NOT NULL
        GROUP BY d.query, d.page, d.site_id, s.name
        HAVING SUM(d.impressions) >= 50
          AND (SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0)) <= 10
      `
      : await sql`
        SELECT
          d.query,
          d.page,
          d.site_id,
          NULL::text AS site_name,
          SUM(d.clicks) AS clicks,
          SUM(d.impressions) AS impressions,
          SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0) AS position
        FROM search_console_data d
        WHERE d.site_id = ${parsedSiteId}
          AND d.date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
          AND d.query IS NOT NULL
          AND d.page IS NOT NULL
        GROUP BY d.query, d.page, d.site_id
        HAVING SUM(d.impressions) >= 50
          AND (SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0)) <= 10
      `;

    const summary = new Map<number, AioSummary>();
    const checkedBySite = new Map<number, { site_id: number; site_name: string | null; checked: number }>();
    const flagged = (rows as AioRow[]).map((r) => {
      const query = String(r.query || "");
      const rawPosition = Number(r.position);
      const pos = Math.max(1, Math.min(10, Math.round(rawPosition)));
      const impressions = Number(r.impressions) || 0;
      const clicks = Number(r.clicks) || 0;
      const ctrActual = clicks / Math.max(1, impressions);
      const ctrExpected = CTR_BENCHMARK[pos] ?? 0.01;
      const ratio = ctrActual / ctrExpected;
      const isInfo = INFO_PATTERNS.test(query);
      const missedClicks = Math.max(0, Math.round(impressions * ctrExpected - clicks));
      const probable = isInfo && ratio < 0.5 && pos <= 5;
      const watch = includeWatch && ratio < 0.75 && pos <= 10 && missedClicks >= 2;
      const numericSiteId = r.site_id !== undefined && r.site_id !== null ? Number(r.site_id) : null;
      const siteName = r.site_name ? String(r.site_name) : null;

      if (numericSiteId !== null && Number.isFinite(numericSiteId)) {
        const existing = checkedBySite.get(numericSiteId) ?? {
          site_id: numericSiteId,
          site_name: siteName,
          checked: 0,
        };
        existing.checked += 1;
        if (!existing.site_name && siteName) existing.site_name = siteName;
        checkedBySite.set(numericSiteId, existing);
      }

      if (!probable && !watch) return null;

      const confidence: "probable" | "watch" = probable ? "probable" : "watch";
      updateSummary(summary, { siteId: numericSiteId, siteName, missedClicks, confidence });

      return {
        query,
        page: String(r.page || ""),
        site_id: numericSiteId,
        site_name: siteName,
        position: Number(rawPosition.toFixed(1)),
        impressions,
        clicks,
        ctr_actual_pct: Number((ctrActual * 100).toFixed(2)),
        ctr_expected_pct: Number((ctrExpected * 100).toFixed(2)),
        ctr_ratio: Number(ratio.toFixed(2)),
        missed_clicks: missedClicks,
        aio_likely: probable,
        confidence,
        recommendation: probable
          ? "AIO probable - ajouter reponse courte, FAQ, sources et donnees citees."
          : "A verifier - CTR bas pour la position. Tester une section reponse rapide/FAQ.",
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null);

    flagged.sort((a, b) => b.missed_clicks - a.missed_clicks);
    const summaryRows = [...summary.values()].sort((a, b) => b.missed_clicks - a.missed_clicks);
    const coverage: AioCoverage[] = isAll
      ? activeSites.map((site) => {
        const siteIdNum = Number(site.site_id);
        const hit = summary.get(siteIdNum);
        const checked = checkedBySite.get(siteIdNum);
        return {
          site_id: siteIdNum,
          site_name: String(site.site_name ?? `Site ${siteIdNum}`),
          candidates: checked?.checked ?? 0,
          probable: hit?.probable ?? 0,
          watch: hit?.watch ?? 0,
          missed_clicks: hit?.missed_clicks ?? 0,
          checked: (checked?.checked ?? 0) > 0,
        };
      }).sort((a, b) => {
        if (b.missed_clicks !== a.missed_clicks) return b.missed_clicks - a.missed_clicks;
        if (b.candidates !== a.candidates) return b.candidates - a.candidates;
        return (a.site_name ?? "").localeCompare(b.site_name ?? "");
      })
      : [];

    return NextResponse.json({
      rows: flagged.slice(0, limit),
      summary: summaryRows,
      coverage,
      scanned: (rows as unknown[]).length,
      sites_scanned: isAll ? activeSites.length : 1,
      sites_with_signals: summaryRows.length,
      days,
      siteId,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
