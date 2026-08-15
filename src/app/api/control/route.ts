export const dynamic = "force-dynamic";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAICached } from "@/lib/ai-cache";
import { requireApiSession } from "@/lib/api-auth";

interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  metric?: number | string;
}

interface ControlIssue {
  module: string;
  status: "warn" | "fail";
  site_id?: number;
  site_name?: string;
  detail: string;
  action: string;
}

interface ControllerReport {
  generated_at: string;
  overall: "healthy" | "degraded" | "broken";
  checks: HealthCheck[];
  issues: ControlIssue[];
  ai_summary: string;
  ai_actions: string[];
}

interface OperationalSiteRow {
  id: number;
  name: string;
  url: string;
  gsc_property: string | null;
  latest_qd: string | null;
  positioned_30d: number;
  latest_sc: string | null;
  queries_30d: number;
  imp_30d: number;
  tracked: number;
  volume_ok: number;
  pos_ok: number;
  signal_ok: number;
  competitor_rows: number;
  competitor_domains: number;
  competitor_latest: string | null;
  llm_rows: number;
  llm_latest: string | null;
  link_rows: number;
  link_domains: number;
  link_count: number;
  pagespeed_rows: number;
  pagespeed_latest: string | null;
  rank_rows: number;
  rank_ranked: number;
  rank_latest: string | null;
}

function envPresent(name: string): boolean {
  return !!process.env[name]?.trim();
}

function ageDays(value: string | null): number {
  if (!value) return 999;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? Math.floor((Date.now() - ts) / 86400000) : 999;
}

function summarizeCoverage(name: string, warn: number, fail: number, okDetail: string, badDetail: string): HealthCheck {
  return {
    name,
    status: fail > 0 ? "fail" : warn > 0 ? "warn" : "ok",
    detail: fail > 0 || warn > 0 ? `${fail} fail / ${warn} warn - ${badDetail}` : okDetail,
    metric: fail + warn,
  };
}

function aiProviderCheck(): HealthCheck {
  const providers: Array<[string, boolean]> = [
    ["Gemini", envPresent("GEMINI_API_KEY") || envPresent("GOOGLE_API_KEY")],
    ["Perplexity", envPresent("PERPLEXITY_API_KEY")],
    ["OpenAI", envPresent("AI_OPENAI_API_KEY") || envPresent("OPENAI_API_KEY")],
    ["Anthropic", envPresent("ANTHROPIC_API_KEY")],
    ["Mammouth", envPresent("MAMMOUTH_API_KEY") || envPresent("MAMMOUTH_KEY")],
  ];
  const configured = providers.filter(([, ok]) => ok).map(([name]) => name);
  const missing = providers.filter(([, ok]) => !ok).map(([name]) => name);
  return {
    name: "AI provider routing",
    status: configured.length > 0 ? "ok" : "fail",
    detail: configured.length > 0
      ? `Providers configured: ${configured.join(", ")}. Missing: ${missing.join(", ") || "none"}.`
      : "No AI provider configured.",
    metric: configured.length,
  };
}

async function runHealthChecks(): Promise<HealthCheck[]> {
  const sql = getSQL();
  const checks: HealthCheck[] = [];

  try {
    const [row] = (await sql`
      SELECT
        to_char(MAX(date), 'YYYY-MM-DD') AS last_date,
        COUNT(*) AS total,
        COUNT(DISTINCT query) AS unique_queries
      FROM search_console_data
    `) as Array<{ last_date: string | null; total: string; unique_queries: string }>;
    const lastDate = row.last_date ? new Date(row.last_date + "T00:00:00Z") : null;
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const lag = lastDate ? Math.floor((todayUtc.getTime() - lastDate.getTime()) / 86400000) : 999;

    checks.push({
      name: "GSC sync freshness",
      status: lag <= 2 ? "ok" : lag <= 4 ? "warn" : "fail",
      detail: lastDate ? `Last data: ${lastDate.toISOString().slice(0, 10)} (${lag}d ago)` : "No GSC data",
      metric: lag,
    });
    checks.push({
      name: "GSC volume",
      status: Number(row.total) >= 10000 ? "ok" : Number(row.total) >= 1000 ? "warn" : "fail",
      detail: `${Number(row.total).toLocaleString()} rows / ${Number(row.unique_queries).toLocaleString()} unique queries`,
      metric: Number(row.total),
    });
  } catch (e) {
    checks.push({ name: "GSC sync freshness", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "unknown"}` });
  }

  try {
    const sites = (await sql`SELECT id, name, gsc_property, is_active FROM sites`) as Array<{
      id: number; name: string; gsc_property: string | null; is_active: boolean;
    }>;
    const ghosts = sites.filter((s) => !s.gsc_property && s.is_active);
    checks.push({
      name: "Sites integrity",
      status: ghosts.length === 0 ? "ok" : "warn",
      detail: ghosts.length > 0
        ? `${ghosts.length} active site(s) without gsc_property: ${ghosts.map((s) => s.name).join(", ")}`
        : `${sites.length} sites total, ${sites.filter((s) => s.is_active).length} active`,
      metric: ghosts.length,
    });
  } catch (e) {
    checks.push({ name: "Sites integrity", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "unknown"}` });
  }

  try {
    const [row] = (await sql`
      SELECT COUNT(*) AS total, COUNT(DISTINCT niche) AS unique_niches, MAX(created_at) AS last_scan
      FROM market_opportunities
    `) as Array<{ total: string; unique_niches: string; last_scan: string | null }>;
    const scanAgeHours = row.last_scan ? Math.floor((Date.now() - new Date(row.last_scan).getTime()) / 3600000) : 999;
    const variety = Number(row.total) > 0 ? Number(row.unique_niches) / Number(row.total) : 0;
    checks.push({
      name: "Opportunity scanner",
      status: scanAgeHours <= 24 ? "ok" : scanAgeHours <= 168 ? "warn" : "fail",
      detail: `${row.unique_niches} unique niches / ${row.total} total - last scan ${scanAgeHours}h ago - variety ${(variety * 100).toFixed(0)}%`,
      metric: scanAgeHours,
    });
  } catch (e) {
    checks.push({ name: "Opportunity scanner", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "unknown"}` });
  }

  try {
    const recent = (await sql`
      SELECT to_char(date, 'YYYY-MM-DD') AS date_str
      FROM search_console_data
      WHERE date >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY date_str
    `) as Array<{ date_str: string }>;
    const days = new Set(recent.map((r) => r.date_str));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const recentLag: string[] = [];
    const historicalGaps: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      if (!days.has(d)) (i <= 3 ? recentLag : historicalGaps).push(d);
    }
    checks.push({
      name: "GSC daily coverage (last 7d)",
      status: historicalGaps.length > 0 ? "fail" : recentLag.length >= 3 ? "warn" : "ok",
      detail: historicalGaps.length || recentLag.length
        ? `${historicalGaps.length} historical gap(s), ${recentLag.length} recent day(s) with normal GSC lag`
        : "All 7 days present",
      metric: historicalGaps.length + recentLag.length,
    });
  } catch (e) {
    checks.push({ name: "GSC daily coverage", status: "fail", detail: `Query error: ${e instanceof Error ? e.message : "unknown"}` });
  }

  return checks;
}

async function runOperationalCoverageChecks(): Promise<{ checks: HealthCheck[]; issues: ControlIssue[] }> {
  const sql = getSQL();
  const checks: HealthCheck[] = [];
  const issues: ControlIssue[] = [];

  const rows = (await sql`
    WITH tk AS (
      SELECT site_id,
        COUNT(*) FILTER (WHERE is_active = TRUE) AS tracked,
        COUNT(*) FILTER (
          WHERE is_active = TRUE
            AND COALESCE(volume_market, volume_ch, volume_fr, 0) > 1
            AND volume_source LIKE 'google_kp_real_%'
        ) AS volume_ok,
        COUNT(*) FILTER (WHERE is_active = TRUE AND COALESCE(current_position, 0) > 0) AS pos_ok,
        COUNT(*) FILTER (WHERE is_active = TRUE AND (current_impressions > 0 OR current_clicks > 0)) AS signal_ok
      FROM tracked_keywords GROUP BY site_id
    ),
    qd AS (
      SELECT site_id, MAX(date) AS latest_qd,
        COUNT(DISTINCT query) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '30 days' AND position BETWEEN 1 AND 200) AS positioned_30d
      FROM search_console_query_data GROUP BY site_id
    ),
    sc AS (
      SELECT site_id, MAX(date) AS latest_sc,
        COUNT(DISTINCT query) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '30 days') AS queries_30d,
        COALESCE(SUM(impressions) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS imp_30d
      FROM search_console_data GROUP BY site_id
    ),
    cr AS (
      SELECT site_id, COUNT(*) AS competitor_rows, COUNT(DISTINCT competitor_domain) AS competitor_domains, MAX(researched_at) AS competitor_latest
      FROM competitor_research GROUP BY site_id
    ),
    llm AS (
      SELECT site_id, COUNT(*) AS llm_rows, MAX(scanned_at) AS llm_latest
      FROM competitor_llm_scan GROUP BY site_id
    ),
    gl AS (
      SELECT site_id, COUNT(*) AS link_rows, COUNT(DISTINCT linking_domain) AS link_domains, COALESCE(SUM(link_count), 0) AS link_count
      FROM gsc_links
      WHERE LOWER(linking_domain) <> 'gsc visibility signal'
      GROUP BY site_id
    ),
    ps AS (
      SELECT site_id, COUNT(*) AS pagespeed_rows, MAX(checked_at) AS pagespeed_latest
      FROM pagespeed_scores GROUP BY site_id
    ),
    rt AS (
      SELECT site_id, COUNT(*) AS rank_rows, MAX(checked_at) AS rank_latest, COUNT(*) FILTER (WHERE our_position IS NOT NULL) AS rank_ranked
      FROM rank_tracking GROUP BY site_id
    )
    SELECT s.id, s.name, s.url, s.gsc_property,
      qd.latest_qd::text, COALESCE(qd.positioned_30d, 0)::int AS positioned_30d,
      sc.latest_sc::text, COALESCE(sc.queries_30d, 0)::int AS queries_30d, COALESCE(sc.imp_30d, 0)::int AS imp_30d,
      COALESCE(tk.tracked, 0)::int AS tracked, COALESCE(tk.volume_ok, 0)::int AS volume_ok,
      COALESCE(tk.pos_ok, 0)::int AS pos_ok, COALESCE(tk.signal_ok, 0)::int AS signal_ok,
      COALESCE(cr.competitor_rows, 0)::int AS competitor_rows, COALESCE(cr.competitor_domains, 0)::int AS competitor_domains,
      cr.competitor_latest::text, COALESCE(llm.llm_rows, 0)::int AS llm_rows, llm.llm_latest::text,
      COALESCE(gl.link_rows, 0)::int AS link_rows, COALESCE(gl.link_domains, 0)::int AS link_domains, COALESCE(gl.link_count, 0)::int AS link_count,
      COALESCE(ps.pagespeed_rows, 0)::int AS pagespeed_rows, ps.pagespeed_latest::text,
      COALESCE(rt.rank_rows, 0)::int AS rank_rows, COALESCE(rt.rank_ranked, 0)::int AS rank_ranked, rt.rank_latest::text
    FROM sites s
    LEFT JOIN tk ON tk.site_id = s.id
    LEFT JOIN qd ON qd.site_id = s.id
    LEFT JOIN sc ON sc.site_id = s.id
    LEFT JOIN cr ON cr.site_id = s.id
    LEFT JOIN llm ON llm.site_id = s.id
    LEFT JOIN gl ON gl.site_id = s.id
    LEFT JOIN ps ON ps.site_id = s.id
    LEFT JOIN rt ON rt.site_id = s.id
    WHERE s.is_active = TRUE
    ORDER BY s.name ASC
  `) as OperationalSiteRow[];

  let keywordWarn = 0, keywordFail = 0, competitorWarn = 0;
  const competitorFail = 0;
  let llmWarn = 0, llmFail = 0, linkWarn = 0, linkFail = 0;
  let pagespeedWarn = 0, pagespeedFail = 0, rankWarn = 0, rankFail = 0;

  for (const site of rows) {
    const volumeCoverage = site.tracked > 0 ? site.volume_ok / site.tracked : 0;
    const positionCoverage = site.tracked > 0 ? site.pos_ok / site.tracked : 0;

    if (!site.gsc_property) {
      issues.push({ module: "GSC", status: "fail", site_id: site.id, site_name: site.name, detail: "No Search Console property configured.", action: "Add the GSC property, then rerun sync." });
    }
    if (site.gsc_property && (site.tracked === 0 || site.positioned_30d === 0)) {
      keywordFail += 1;
      issues.push({ module: "Keywords", status: "fail", site_id: site.id, site_name: site.name, detail: `${site.tracked} tracked keywords, ${site.positioned_30d} positioned queries over 30d.`, action: "Rerun GSC sync and import/reconcile keyword volumes." });
    } else if (site.gsc_property && (volumeCoverage < 0.8 || positionCoverage < 0.5)) {
      keywordWarn += 1;
      issues.push({ module: "Keywords", status: "warn", site_id: site.id, site_name: site.name, detail: `Keyword Planner coverage ${Math.round(volumeCoverage * 100)}%, GSC position coverage ${Math.round(positionCoverage * 100)}%.`, action: "Reconcile tracked_keywords with GSC and import missing volumes." });
    }
    if (site.competitor_domains < 3 || site.competitor_rows < 5) {
      competitorWarn += 1;
      issues.push({ module: "Competitors", status: "warn", site_id: site.id, site_name: site.name, detail: `${site.competitor_domains} competitor domains / ${site.competitor_rows} rows. No verified competitor source is configured, so the dashboard does not fabricate AI estimates as real data.`, action: "Configure a verified competitor data source, then refresh the cache." });
    } else if (ageDays(site.competitor_latest) > 35) {
      competitorWarn += 1;
      issues.push({ module: "Competitors", status: "warn", site_id: site.id, site_name: site.name, detail: `Competitor cache age ${ageDays(site.competitor_latest)}d.`, action: "Run one grouped live AI rescan." });
    }
    if (site.llm_rows === 0) {
      llmFail += 1;
      issues.push({ module: "LLM scoring", status: "fail", site_id: site.id, site_name: site.name, detail: "No /llms.txt, robots.txt or JSON-LD scan cache.", action: "Run LLM readiness scan." });
    } else if (ageDays(site.llm_latest) > 14) {
      llmWarn += 1;
      issues.push({ module: "LLM scoring", status: "warn", site_id: site.id, site_name: site.name, detail: `LLM scan age ${ageDays(site.llm_latest)}d.`, action: "Refresh LLM readiness cache." });
    }
    if (site.gsc_property && site.link_rows === 0) {
      linkFail += 1;
      issues.push({ module: "Backlinks/GSC links", status: "fail", site_id: site.id, site_name: site.name, detail: "No verified backlink cache.", action: "Import a verified links export or connect an authorized backlink source." });
    } else if (site.link_rows > 0 && site.link_domains <= 1) {
      linkWarn += 1;
      issues.push({ module: "Backlinks/GSC links", status: "warn", site_id: site.id, site_name: site.name, detail: `${site.link_rows} rows, ${site.link_domains} referring domain.`, action: "Validate the backlinks source and refresh its export." });
    }
    if (site.pagespeed_rows === 0) pagespeedFail += 1;
    else if (ageDays(site.pagespeed_latest) > 14) pagespeedWarn += 1;
    if (site.rank_rows === 0) rankFail += 1;
    else if (ageDays(site.rank_latest) > 7) rankWarn += 1;
  }

  const gscSites = rows.filter((r) => r.gsc_property).length;
  checks.push(summarizeCoverage("Keyword table coverage", keywordWarn, keywordFail, `Keywords, volumes and positions usable on ${rows.length} sites.`, "sites lack usable keywords, volumes or positions"));
  checks.push(summarizeCoverage("Competitor cache coverage", competitorWarn, competitorFail, `Competitor cache usable on ${rows.length} sites.`, "competitor caches are empty or stale"));
  checks.push(summarizeCoverage("LLM readiness coverage", llmWarn, llmFail, `LLM scans available on ${rows.length} sites.`, "LLM scans are missing or stale"));
  checks.push(summarizeCoverage("Backlinks coverage", linkWarn, linkFail, `Verified backlink data available on ${gscSites} GSC sites.`, "verified backlink data is missing"));
  checks.push({
    name: "PageSpeed configuration",
    status: envPresent("PAGESPEED_API_KEY") ? (pagespeedFail > 0 ? "warn" : "ok") : "warn",
    detail: envPresent("PAGESPEED_API_KEY")
      ? `${pagespeedFail} site(s) without PageSpeed data, ${pagespeedWarn} stale measurement(s).`
      : "PAGESPEED_API_KEY missing: PageSpeed may work without a key, but public quota is fragile.",
    metric: pagespeedFail + pagespeedWarn,
  });
  checks.push({
    name: "SERP rank tracker configuration",
    status: envPresent("BRAVE_SEARCH_API_KEY") ? (rankFail > 0 ? "warn" : "ok") : "warn",
    detail: envPresent("BRAVE_SEARCH_API_KEY")
      ? `${rankFail} site(s) without Brave SERP tracking, ${rankWarn} stale measurement(s).`
      : "BRAVE_SEARCH_API_KEY missing: live Brave SERP top-10 is disabled, GSC position fallback remains available.",
    metric: rankFail + rankWarn,
  });
  checks.push(aiProviderCheck());

  return { checks, issues: issues.slice(0, 100) };
}

async function probeEndpoint(
  name: string,
  path: string,
  baseUrl: string,
  forwardedHeaders: { cookie?: string; authorization?: string },
): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        ...(forwardedHeaders.cookie ? { cookie: forwardedHeaders.cookie } : {}),
        ...(forwardedHeaders.authorization ? { authorization: forwardedHeaders.authorization } : {}),
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(8000),
    });
    const ms = Date.now() - start;
    if (!res.ok) return { name, status: "fail", detail: `HTTP ${res.status} (${ms}ms)`, metric: res.status };
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        name,
        status: "fail",
        detail: `Réponse non JSON (${ms}ms, ${text.length} octets)`,
      };
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (name === "GET /api/realtime (GA4)" && typeof obj.totalActive === "number") {
        return { name, status: "ok", detail: `${obj.totalActive} active visitor(s) (${ms}ms)`, metric: obj.totalActive };
      }
      if (name === "GET /api/seo-health" && obj.success === true && typeof obj.overall_score === "number") {
        return { name, status: "ok", detail: `grade ${String(obj.grade ?? "n/a")} / ${obj.overall_score} (${ms}ms)`, metric: obj.overall_score };
      }
      if (name === "GET /api/LLM readiness cache" && (obj.own_site_scan || Array.isArray(obj.scans))) {
        const scanCount = Array.isArray(obj.scans) ? obj.scans.length : 0;
        return { name, status: "ok", detail: `${scanCount} competitor scan(s) + own-site scan (${ms}ms)`, metric: scanCount + 1 };
      }
      const arr = ["data", "queries", "rows", "items", "opportunities", "results", "sites", "history", "pages", "gaps", "links", "checks", "scans"]
        .map((k) => obj[k]).find((v): v is unknown[] => Array.isArray(v));
      const count = arr ? arr.length : Array.isArray(parsed) ? parsed.length : 0;
      return { name, status: count === 0 ? "warn" : "ok", detail: count === 0 ? `200 but 0 results (${ms}ms)` : `${count} results (${ms}ms)`, metric: count };
    }
    return { name, status: "warn", detail: `200 (${ms}ms, réponse JSON sans données reconnues)` };
  } catch (e) {
    return { name, status: "fail", detail: `Network error: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

async function runEndpointProbes(
  baseUrl: string,
  forwardedHeaders: { cookie?: string; authorization?: string },
): Promise<HealthCheck[]> {
  const sql = getSQL();
  const sites = (await sql`
    SELECT id, ga_property_id
    FROM sites
    WHERE is_active = TRUE AND gsc_property IS NOT NULL
    ORDER BY id
    LIMIT 1
  `) as Array<{ id: number; ga_property_id: string | null }>;
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

  const probes: Array<[string, string]> = [["GET /api/sites", "/api/sites"], ["GET /api/overview", "/api/overview"], ["GET /api/dashboard-quality", "/api/dashboard-quality"]];
  if (sampleSiteId) {
    probes.push(["GET /api/search-console queries", `/api/search-console?siteId=${sampleSiteId}&type=queries&days=30&limit=50`]);
    probes.push(["GET /api/search-console gains", `/api/search-console?siteId=${sampleSiteId}&type=gains&limit=30`]);
    probes.push(["GET /api/competitors cache", `/api/competitors?site_id=${sampleSiteId}`]);
    probes.push(["GET /api/competitor gaps", `/api/competitors/gaps?siteId=${sampleSiteId}`]);
    probes.push(["GET /api/LLM readiness cache", `/api/competitors/llm-scan?site_id=${sampleSiteId}`]);
    probes.push(["GET /api/backlinks", `/api/gsc-links?site_id=${sampleSiteId}`]);
    probes.push(["GET /api/rank tracker status", `/api/rank-tracker/status?site_id=${sampleSiteId}&cycle_days=4&engine=brave`]);
    probes.push(["GET /api/seo-health", `/api/seo-health?site_id=${sampleSiteId}`]);
    if (sampleQuery) probes.push(["GET /api/keyword-history", `/api/keyword-history?siteId=${sampleSiteId}&query=${encodeURIComponent(sampleQuery)}&days=30`]);
    if (sampleGa4Property) probes.push(["GET /api/realtime (GA4)", `/api/realtime?propertyId=${encodeURIComponent(sampleGa4Property)}`]);
  }
  probes.push(["GET /api/opportunities/scan", "/api/opportunities/scan"]);
  return Promise.all(probes.map(([name, path]) => probeEndpoint(name, path, baseUrl, forwardedHeaders)));
}

async function buildAISummary(checks: HealthCheck[]): Promise<{ summary: string; actions: string[] }> {
  const failing = checks.filter((c) => c.status === "fail");
  const warning = checks.filter((c) => c.status === "warn");
  if (failing.length === 0 && warning.length === 0) {
    return { summary: "All dashboard systems are nominal.", actions: [] };
  }

  const prompt = `You are the controller agent for a SEO dashboard. Analyze the checks and return strict JSON in French:
{"summary":"2 phrases max","actions":["short imperative action","short imperative action","short imperative action"]}

Checks:
${JSON.stringify(checks, null, 2)}`;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const { reply: raw } = await askAICached({
      cacheKey: `control-summary:${today}:${failing.length}:${warning.length}:${checks.length}`,
      messages: [{ role: "user", content: prompt }],
      model: "fast",
      maxTokens: 600,
    });
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()) as { summary?: string; actions?: string[] };
    return { summary: parsed.summary ?? "Plusieurs alertes detectees.", actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 5) : [] };
  } catch {
    return {
      summary: `${failing.length} echec(s), ${warning.length} avertissement(s) detecte(s).`,
      actions: failing.concat(warning).map((c) => `Corriger ${c.name}: ${c.detail}`).slice(0, 5),
    };
  }
}

export async function GET(req: Request) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const baseUrl = new URL(req.url).origin;
    const forwardedHeaders = {
      cookie: req.headers.get("cookie") ?? undefined,
      authorization: req.headers.get("authorization") ?? undefined,
    };
    const [dbChecks, coverage, endpointChecks] = await Promise.all([
      runHealthChecks(),
      runOperationalCoverageChecks(),
      runEndpointProbes(baseUrl, forwardedHeaders).catch(() => [] as HealthCheck[]),
    ]);
    const checks = [...dbChecks, ...coverage.checks, ...endpointChecks];
    const failCount = checks.filter((c) => c.status === "fail").length;
    const warnCount = checks.filter((c) => c.status === "warn").length;
    const overall: ControllerReport["overall"] = failCount > 0 ? "broken" : warnCount > 0 ? "degraded" : "healthy";
    const { summary, actions } = await buildAISummary(checks);

    return NextResponse.json({
      success: true,
      report: {
        generated_at: new Date().toISOString(),
        overall,
        checks,
        issues: coverage.issues,
        ai_summary: summary,
        ai_actions: actions,
      } satisfies ControllerReport,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
