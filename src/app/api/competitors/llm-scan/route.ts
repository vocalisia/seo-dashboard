export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getSQL, ensureSchema } from "@/lib/db";
import { logError, logger } from "@/lib/logger";
import { scanCompetitors, scoreReadiness, type LLMScanFindings } from "@/lib/llm-scan";
import { requireCronOrUser } from "@/lib/cron-auth";

const CACHE_DAYS = 7;

interface CachedScanRow {
  competitor_domain: string;
  llms_txt_present: boolean;
  llms_txt_content: string | null;
  ai_bots_allowed: string[] | null;
  schemas_detected: string[] | null;
  llm_readiness_score: number;
  raw_findings: LLMScanFindings | null;
  scanned_at: string;
}

interface ScanResultPayload {
  competitor_domain: string;
  llm_readiness_score: number;
  llms_txt_present: boolean;
  llms_txt_content: string | null;
  ai_bots_allowed: string[];
  ai_bots_disallowed: string[];
  schemas_detected: string[];
  recommendations: string[];
  has_open_graph: boolean;
  scanned_at: string;
}

function findingsToPayload(
  domain: string,
  f: LLMScanFindings,
  scannedAt: string,
): ScanResultPayload {
  return {
    competitor_domain: domain,
    llm_readiness_score: f.llm_readiness_score,
    llms_txt_present: f.llms_txt_present,
    llms_txt_content: f.llms_txt_content,
    ai_bots_allowed: f.ai_bots_allowed,
    ai_bots_disallowed: f.ai_bots_disallowed ?? [],
    schemas_detected: f.schemas_detected,
    recommendations: f.recommendations,
    has_open_graph: f.has_open_graph,
    scanned_at: scannedAt,
  };
}

function cacheRowToPayload(row: CachedScanRow): ScanResultPayload {
  const raw = row.raw_findings ?? null;
  const aiBotsAllowed = Array.isArray(row.ai_bots_allowed) ? row.ai_bots_allowed : [];
  const aiBotsExplicit = Array.isArray(raw?.ai_bots_allowed_explicitly)
    ? raw.ai_bots_allowed_explicitly
    : [];
  const aiBotsPassive = aiBotsAllowed.filter((bot) => !aiBotsExplicit.includes(bot));
  const schemasDetected = Array.isArray(row.schemas_detected) ? row.schemas_detected : [];
  const recalculated = scoreReadiness(
    raw?.llms_txt_valid ?? !!row.llms_txt_present,
    aiBotsExplicit,
    aiBotsPassive,
    schemasDetected,
    raw?.has_open_graph ?? false,
  );

  return {
    competitor_domain: row.competitor_domain,
    llm_readiness_score: recalculated.score,
    llms_txt_present: !!row.llms_txt_present,
    llms_txt_content: row.llms_txt_content,
    ai_bots_allowed: aiBotsAllowed,
    ai_bots_disallowed: raw?.ai_bots_disallowed ?? [],
    schemas_detected: schemasDetected,
    recommendations: recalculated.recommendations,
    has_open_graph: raw?.has_open_graph ?? false,
    scanned_at: row.scanned_at,
  };
}

/**
 * GET /api/competitors/llm-scan?site_id=X
 * Returns cached scans (no auth — read-only, same as parent /api/competitors GET).
 */
export async function GET(req: NextRequest) {
  const siteIdParam = req.nextUrl.searchParams.get("site_id");
  if (!siteIdParam) {
    return NextResponse.json(
      { success: false, error: "site_id required" },
      { status: 400 },
    );
  }
  const siteId = parseInt(siteIdParam, 10);
  if (!Number.isFinite(siteId)) {
    return NextResponse.json(
      { success: false, error: "site_id invalid" },
      { status: 400 },
    );
  }

  const sql = getSQL();
  try {
    await ensureSchema();
    const rows = (await sql`
      SELECT competitor_domain, llms_txt_present, llms_txt_content,
             ai_bots_allowed, schemas_detected, llm_readiness_score,
             raw_findings, scanned_at
      FROM competitor_llm_scan
      WHERE site_id = ${siteId}
      ORDER BY llm_readiness_score DESC, scanned_at DESC
    `) as CachedScanRow[];

    const scans = rows.map(cacheRowToPayload);

    // Identify the "own site" scan (if scanned) by matching against sites.url
    const siteRows = (await sql`SELECT url FROM sites WHERE id = ${siteId} LIMIT 1`) as { url: string }[];
    const ownDomain = siteRows[0]?.url
      ? siteRows[0].url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").toLowerCase()
      : null;
    let own_site_scan: ScanResultPayload | null = null;
    const competitor_scans: ScanResultPayload[] = [];
    for (const s of scans) {
      const sDom = s.competitor_domain.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
      if (ownDomain && (sDom === ownDomain || sDom.includes(ownDomain) || ownDomain.includes(sDom))) {
        own_site_scan = s;
      } else {
        competitor_scans.push(s);
      }
    }

    return NextResponse.json({
      success: true,
      site_id: siteId,
      own_site_scan,
      scans: competitor_scans,
      total: competitor_scans.length,
      cache_age_days: CACHE_DAYS,
    });
  } catch (err) {
    logError("competitors.llmScan.GET", err, { siteId });
    return NextResponse.json({ success: true, site_id: siteId, scans: [], total: 0 });
  }
}

/**
 * POST /api/competitors/llm-scan?site_id=X
 * Triggers a fresh scan for all competitor_research domains tied to the site.
 *
 * Auth: cron secret OR user session.
 * Honors 7-day cache by default — pass {force_refresh: true} in body to bypass.
 */
export async function POST(req: NextRequest) {
  const authError = await requireCronOrUser(req);
  if (authError) return authError;

  const siteIdParam = req.nextUrl.searchParams.get("site_id");
  if (!siteIdParam) {
    return NextResponse.json(
      { success: false, error: "site_id required" },
      { status: 400 },
    );
  }
  const siteId = parseInt(siteIdParam, 10);
  if (!Number.isFinite(siteId)) {
    return NextResponse.json(
      { success: false, error: "site_id invalid" },
      { status: 400 },
    );
  }

  let body: { force_refresh?: boolean; domains?: string[]; include_own_site?: boolean } = {};
  try {
    body = (await req.json()) as { force_refresh?: boolean; domains?: string[]; include_own_site?: boolean };
  } catch {
    body = {};
  }
  const forceRefresh = !!body.force_refresh;
  const includeOwnSite = body.include_own_site !== false; // default true

  const sql = getSQL();

  try {
    await ensureSchema();

    // 1) Determine domains to scan — body.domains OR distinct competitors of site
    let domains: string[] = Array.isArray(body.domains)
      ? body.domains.filter((d): d is string => typeof d === "string" && d.length > 0)
      : [];

    if (domains.length === 0) {
      const rows = (await sql`
        SELECT DISTINCT competitor_domain
        FROM competitor_research
        WHERE site_id = ${siteId}
          AND competitor_domain IS NOT NULL
      `) as { competitor_domain: string }[];
      domains = rows
        .map((r) => r.competitor_domain)
        .filter((d): d is string => !!d && d.length > 0);
    }

    // Prepend the site's own URL when include_own_site (default true)
    if (includeOwnSite) {
      const siteRows = (await sql`SELECT url FROM sites WHERE id = ${siteId} LIMIT 1`) as { url: string }[];
      const ownUrl = siteRows[0]?.url;
      if (ownUrl) {
        const ownDomain = ownUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").toLowerCase();
        const alreadyIn = domains.some((d) => d.toLowerCase().includes(ownDomain) || ownDomain.includes(d.toLowerCase()));
        if (!alreadyIn) domains = [ownDomain, ...domains];
      }
    }

    if (domains.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Aucun concurrent à scanner. Lance d'abord l'analyse concurrentielle.",
      });
    }

    // 2) Honor 7-day cache unless forceRefresh
    let toScan = domains;
    const cached = new Map<string, ScanResultPayload>();
    if (!forceRefresh) {
      const cachedRows = (await sql`
        SELECT competitor_domain, llms_txt_present, llms_txt_content,
               ai_bots_allowed, schemas_detected, llm_readiness_score,
               raw_findings, scanned_at
        FROM competitor_llm_scan
        WHERE site_id = ${siteId}
          AND scanned_at >= NOW() - (${CACHE_DAYS} || ' days')::interval
      `) as CachedScanRow[];

      const cachedDomains = new Set(
        cachedRows.map((r) => r.competitor_domain.toLowerCase()),
      );
      for (const r of cachedRows) cached.set(r.competitor_domain.toLowerCase(), cacheRowToPayload(r));
      toScan = domains.filter((d) => !cachedDomains.has(d.toLowerCase()));
    }

    logger.info({
      ctx: "competitors.llmScan.POST",
      siteId,
      totalDomains: domains.length,
      toScan: toScan.length,
      cached: domains.length - toScan.length,
      forceRefresh,
    });

    // 3) Run fresh scans
    const freshResults: ScanResultPayload[] = [];
    if (toScan.length > 0) {
      const scans = await scanCompetitors(toScan, 4);
      const now = new Date().toISOString();
      for (const { domain, findings } of scans) {
        const payload = findingsToPayload(domain, findings, now);
        freshResults.push(payload);
        try {
          await sql`
            INSERT INTO competitor_llm_scan
              (site_id, competitor_domain, llms_txt_present, llms_txt_content,
               ai_bots_allowed, schemas_detected, llm_readiness_score, raw_findings, scanned_at)
            VALUES
              (${siteId}, ${domain}, ${findings.llms_txt_present},
               ${findings.llms_txt_content},
               ${JSON.stringify(findings.ai_bots_allowed)}::jsonb,
               ${JSON.stringify(findings.schemas_detected)}::jsonb,
               ${findings.llm_readiness_score},
               ${JSON.stringify(findings)}::jsonb,
               NOW())
            ON CONFLICT (site_id, LOWER(competitor_domain)) DO UPDATE SET
              llms_txt_present = EXCLUDED.llms_txt_present,
              llms_txt_content = EXCLUDED.llms_txt_content,
              ai_bots_allowed = EXCLUDED.ai_bots_allowed,
              schemas_detected = EXCLUDED.schemas_detected,
              llm_readiness_score = EXCLUDED.llm_readiness_score,
              raw_findings = EXCLUDED.raw_findings,
              scanned_at = NOW()
          `;
        } catch (err) {
          logError("competitors.llmScan.store", err, { siteId, domain });
        }
      }
    }

    // 4) Merge fresh + cached, preserve domain order
    const merged: ScanResultPayload[] = [];
    for (const d of domains) {
      const fresh = freshResults.find(
        (r) => r.competitor_domain.toLowerCase() === d.toLowerCase(),
      );
      if (fresh) {
        merged.push(fresh);
        continue;
      }
      const c = cached.get(d.toLowerCase());
      if (c) merged.push(c);
    }
    merged.sort((a, b) => b.llm_readiness_score - a.llm_readiness_score);

    return NextResponse.json({
      success: true,
      site_id: siteId,
      scans: merged,
      total: merged.length,
      scanned_now: freshResults.length,
      from_cache: merged.length - freshResults.length,
    });
  } catch (err) {
    logError("competitors.llmScan.POST", err, { siteId });
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 },
    );
  }
}
