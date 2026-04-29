export const dynamic = "force-dynamic";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";

interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  metric?: number | string;
}

interface ControllerReport {
  generated_at: string;
  overall: "healthy" | "degraded" | "broken";
  checks: HealthCheck[];
  ai_summary: string;
  ai_actions: string[];
}

async function runHealthChecks(): Promise<HealthCheck[]> {
  const sql = getSQL();
  const checks: HealthCheck[] = [];

  try {
    const [{ last_date, total, unique_queries }] = (await sql`
      SELECT
        to_char(MAX(date), 'YYYY-MM-DD') AS last_date,
        COUNT(*) AS total,
        COUNT(DISTINCT query) AS unique_queries
      FROM search_console_data
    `) as Array<{ last_date: string | null; total: string; unique_queries: string }>;

    const lastDate = last_date ? new Date(last_date + "T00:00:00Z") : null;
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const ageDays = lastDate ? Math.floor((todayUtc.getTime() - lastDate.getTime()) / 86400000) : 999;

    checks.push({
      name: "GSC sync freshness",
      status: ageDays <= 1 ? "ok" : ageDays <= 3 ? "warn" : "fail",
      detail: lastDate ? `Last data: ${lastDate.toISOString().slice(0, 10)} (${ageDays}d ago)` : "No GSC data",
      metric: ageDays,
    });

    checks.push({
      name: "GSC volume",
      status: Number(total) >= 10000 ? "ok" : Number(total) >= 1000 ? "warn" : "fail",
      detail: `${Number(total).toLocaleString()} rows / ${Number(unique_queries).toLocaleString()} unique queries`,
      metric: Number(total),
    });
  } catch (e) {
    checks.push({ name: "GSC sync freshness", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "?"}` });
  }

  try {
    const sites = (await sql`SELECT id, name, gsc_property, is_active FROM sites`) as Array<{
      id: number; name: string; gsc_property: string | null; is_active: boolean;
    }>;
    const ghosts = sites.filter((s) => !s.gsc_property && s.is_active);
    const orphans = sites.filter((s) => s.name?.startsWith("[orphan]"));

    checks.push({
      name: "Sites integrity",
      status: ghosts.length === 0 ? "ok" : "fail",
      detail: ghosts.length > 0
        ? `${ghosts.length} active site(s) without gsc_property: ${ghosts.map((s) => s.name).join(", ")}`
        : `${sites.length} sites total, ${sites.filter((s) => s.is_active).length} active, ${orphans.length} orphaned`,
      metric: ghosts.length,
    });
  } catch (e) {
    checks.push({ name: "Sites integrity", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "?"}` });
  }

  try {
    const oppRows = (await sql`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT niche) AS unique_niches,
        MAX(created_at) AS last_scan
      FROM market_opportunities
    `) as Array<{ total: string; unique_niches: string; last_scan: string | null }>;
    const row = oppRows[0];
    const lastScan = row.last_scan ? new Date(row.last_scan) : null;
    const scanAgeHours = lastScan ? Math.floor((Date.now() - lastScan.getTime()) / 3600000) : 999;
    const variety = Number(row.total) > 0 ? Number(row.unique_niches) / Number(row.total) : 0;

    checks.push({
      name: "Opportunity scanner",
      status: scanAgeHours <= 24 ? "ok" : scanAgeHours <= 168 ? "warn" : "fail",
      detail: `${row.unique_niches} unique niches / ${row.total} total — last scan ${scanAgeHours}h ago — variety ${(variety * 100).toFixed(0)}%`,
      metric: scanAgeHours,
    });
  } catch (e) {
    checks.push({ name: "Opportunity scanner", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "?"}` });
  }

  try {
    const recent = (await sql`
      SELECT to_char(date, 'YYYY-MM-DD') AS date_str, COUNT(*) AS rows
      FROM search_console_data
      WHERE date >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY date_str
      ORDER BY date_str DESC
    `) as Array<{ date_str: string; rows: string }>;

    const days = new Set(recent.map((r) => r.date_str));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const recentLag: string[] = [];
    const historicalGaps: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      const dStr = d.toISOString().slice(0, 10);
      if (!days.has(dStr)) {
        if (i <= 3) recentLag.push(dStr);
        else historicalGaps.push(dStr);
      }
    }

    const status: HealthCheck["status"] =
      historicalGaps.length > 0 ? "fail" :
      recentLag.length >= 3 ? "warn" :
      "ok";

    const parts: string[] = [];
    if (historicalGaps.length > 0) parts.push(`${historicalGaps.length} historical gap(s): ${historicalGaps.join(", ")}`);
    if (recentLag.length > 0) parts.push(`${recentLag.length} recent day(s) (normal GSC 2-3d lag): ${recentLag.join(", ")}`);
    if (parts.length === 0) parts.push("All 7 days present");

    checks.push({
      name: "GSC daily coverage (last 7d)",
      status,
      detail: parts.join(" — "),
      metric: historicalGaps.length + recentLag.length,
    });
  } catch (e) {
    checks.push({ name: "GSC daily coverage", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "?"}` });
  }

  try {
    const sites = (await sql`SELECT id, name FROM sites WHERE is_active = true AND gsc_property IS NOT NULL ORDER BY id`) as Array<{ id: number; name: string }>;
    const targetSites = sites.slice(0, 5);

    const sitesWithFreshData = (await sql`
      SELECT
        site_id,
        COUNT(*) AS rows,
        MAX(date) AS last_date,
        SUM(impressions) AS total_imp,
        SUM(clicks) AS total_clicks
      FROM search_console_data
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        AND site_id = ANY(${targetSites.map((s) => s.id)})
      GROUP BY site_id
    `) as Array<{ site_id: number; rows: string; last_date: string; total_imp: string; total_clicks: string }>;

    const dataMap = new Map(sitesWithFreshData.map((r) => [r.site_id, r]));
    const sitesWithNoData = targetSites.filter((s) => !dataMap.has(s.id));
    const sitesNoTraffic = targetSites.filter((s) => {
      const d = dataMap.get(s.id);
      return d && Number(d.total_imp) === 0;
    });

    checks.push({
      name: "Per-site GSC data freshness",
      status: sitesWithNoData.length > 0 ? "fail" : sitesNoTraffic.length > targetSites.length / 2 ? "warn" : "ok",
      detail: sitesWithNoData.length > 0
        ? `${sitesWithNoData.length} site(s) sans aucune donnée 30j: ${sitesWithNoData.map((s) => s.name).join(", ")}`
        : sitesNoTraffic.length > 0
          ? `${sitesNoTraffic.length}/${targetSites.length} sites avec 0 impressions sur 30j`
          : `Tous les ${targetSites.length} sites testés ont du trafic récent`,
      metric: sitesWithNoData.length,
    });
  } catch (e) {
    checks.push({ name: "Per-site GSC data freshness", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "?"}` });
  }

  try {
    const [{ recent_queries }] = (await sql`
      SELECT COUNT(DISTINCT query) AS recent_queries
      FROM search_console_data
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    `) as Array<{ recent_queries: string }>;

    const [{ historical_queries }] = (await sql`
      SELECT COUNT(DISTINCT query) AS historical_queries
      FROM search_console_data
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        AND date < CURRENT_DATE - INTERVAL '7 days'
    `) as Array<{ historical_queries: string }>;

    const recent = Number(recent_queries);
    const historical = Number(historical_queries);
    const ratio = historical > 0 ? recent / historical : 0;

    checks.push({
      name: "Keyword diversity trend (7d vs prev 23d)",
      status: recent === 0 ? "fail" : ratio < 0.3 ? "warn" : "ok",
      detail: `${recent} queries uniques sur 7j / ${historical} sur 23j précédents (ratio ${(ratio * 100).toFixed(0)}%)`,
      metric: recent,
    });
  } catch (e) {
    checks.push({ name: "Keyword diversity trend", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "?"}` });
  }

  try {
    const [{ total_clicks_7d, total_imp_7d }] = (await sql`
      SELECT
        COALESCE(SUM(clicks), 0) AS total_clicks_7d,
        COALESCE(SUM(impressions), 0) AS total_imp_7d
      FROM search_console_data
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    `) as Array<{ total_clicks_7d: string; total_imp_7d: string }>;

    const clicks = Number(total_clicks_7d);
    const imp = Number(total_imp_7d);

    checks.push({
      name: "Traffic volume (last 7d)",
      status: imp === 0 ? "fail" : imp < 100 ? "warn" : "ok",
      detail: `${imp.toLocaleString()} impressions / ${clicks.toLocaleString()} clics`,
      metric: imp,
    });
  } catch (e) {
    checks.push({ name: "Traffic volume", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "?"}` });
  }

  return checks;
}

async function probeEndpoint(name: string, path: string, baseUrl: string, cookieHeader: string): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { cookie: cookieHeader, "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(8000),
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      return { name, status: "fail", detail: `HTTP ${res.status} (${ms}ms)`, metric: res.status };
    }
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* not json */ }

    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const dataKeys = ["data", "queries", "rows", "items", "opportunities", "results", "sites", "history", "pages"];
      const arr = dataKeys
        .map((k) => obj[k])
        .find((v): v is unknown[] => Array.isArray(v));
      const count = arr ? arr.length : (Array.isArray(parsed) ? (parsed as unknown[]).length : 0);
      return {
        name,
        status: count === 0 ? "warn" : "ok",
        detail: count === 0 ? `200 mais 0 résultats (${ms}ms)` : `${count} résultats (${ms}ms)`,
        metric: count,
      };
    }
    return { name, status: "ok", detail: `200 (${ms}ms, non-JSON ${text.length} bytes)` };
  } catch (e) {
    return { name, status: "fail", detail: `Erreur réseau: ${e instanceof Error ? e.message : "?"}` };
  }
}

async function runEndpointProbes(baseUrl: string, cookieHeader: string): Promise<HealthCheck[]> {
  const sql = getSQL();
  const sites = (await sql`SELECT id, ga_property_id FROM sites WHERE is_active = true AND gsc_property IS NOT NULL ORDER BY id LIMIT 1`) as Array<{ id: number; ga_property_id: string | null }>;
  const sampleSiteId = sites[0]?.id;
  const sampleGa4Property = sites[0]?.ga_property_id;

  let sampleQuery: string | null = null;
  if (sampleSiteId) {
    const qRows = (await sql`
      SELECT query FROM search_console_data
      WHERE site_id = ${sampleSiteId} AND query IS NOT NULL AND impressions >= 5
      ORDER BY date DESC LIMIT 1
    `) as Array<{ query: string }>;
    sampleQuery = qRows[0]?.query ?? null;
  }

  const probes: Array<[string, string]> = [
    ["GET /api/sites", "/api/sites"],
    ["GET /api/overview", "/api/overview"],
  ];
  if (sampleSiteId) {
    probes.push(["GET /api/search-console queries", `/api/search-console?siteId=${sampleSiteId}&type=queries&days=30&limit=50`]);
    probes.push(["GET /api/search-console gains", `/api/search-console?siteId=${sampleSiteId}&type=gains&limit=30`]);
    if (sampleQuery) {
      probes.push(["GET /api/keyword-history", `/api/keyword-history?siteId=${sampleSiteId}&query=${encodeURIComponent(sampleQuery)}&days=30`]);
    }
    if (sampleGa4Property) {
      probes.push(["GET /api/realtime (GA4)", `/api/realtime?propertyId=${encodeURIComponent(sampleGa4Property)}`]);
    }
    probes.push(["GET /api/seo-health", `/api/seo-health?site_id=${sampleSiteId}`]);
  }
  probes.push(["GET /api/opportunities/scan", "/api/opportunities/scan"]);

  return Promise.all(probes.map(([name, path]) => probeEndpoint(name, path, baseUrl, cookieHeader)));
}

async function buildAISummary(checks: HealthCheck[]): Promise<{ summary: string; actions: string[] }> {
  const failing = checks.filter((c) => c.status === "fail");
  const warning = checks.filter((c) => c.status === "warn");

  if (failing.length === 0 && warning.length === 0) {
    return {
      summary: "Tous les systèmes nominaux. Pipeline GSC, sites, scanner d'opportunités et couverture quotidienne sont sains.",
      actions: [],
    };
  }

  const prompt = `Tu es l'agent contrôleur d'un dashboard SEO. Analyse ces health checks et produis :
1. Un résumé en français (2 phrases max)
2. 3 actions concrètes à exécuter pour fixer les problèmes (en français, format imperatif court)

Health checks:
${JSON.stringify(checks, null, 2)}

Réponds en JSON strict:
{"summary": "...", "actions": ["...", "...", "..."]}`;

  try {
    const raw = await askAI([{ role: "user", content: prompt }], "fast", 600);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { summary?: string; actions?: string[] };
    return {
      summary: parsed.summary ?? "Plusieurs alertes détectées.",
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 5) : [],
    };
  } catch {
    return {
      summary: `${failing.length} échec(s), ${warning.length} avertissement(s) détectés.`,
      actions: failing.map((c) => `Fix ${c.name}: ${c.detail}`).slice(0, 3),
    };
  }
}

export async function GET(req: Request) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const baseUrl = new URL(req.url).origin;
    const cookieHeader = req.headers.get("cookie") ?? "";

    const [dbChecks, endpointChecks] = await Promise.all([
      runHealthChecks(),
      runEndpointProbes(baseUrl, cookieHeader).catch(() => [] as HealthCheck[]),
    ]);
    const checks = [...dbChecks, ...endpointChecks];

    const failCount = checks.filter((c) => c.status === "fail").length;
    const warnCount = checks.filter((c) => c.status === "warn").length;
    const overall: ControllerReport["overall"] =
      failCount > 0 ? "broken" : warnCount > 0 ? "degraded" : "healthy";

    const { summary, actions } = await buildAISummary(checks);

    const report: ControllerReport = {
      generated_at: new Date().toISOString(),
      overall,
      checks,
      ai_summary: summary,
      ai_actions: actions,
    };

    return NextResponse.json({ success: true, report });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
