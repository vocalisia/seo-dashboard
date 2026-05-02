export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { resolvePublishedArticleLiveUrl } from "@/lib/autopilot-published-url";
import { requireCronOrUser } from "@/lib/cron-auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SiteRow {
  id: number;
  name: string;
  url: string;
}

interface PositionDrop {
  keyword: string;
  prev_avg: number;
  curr_avg: number;
  drop: number;
}

interface UnindexedArticle {
  run_id: number;
  keyword: string;
  live_url: string;
  status_code: number | null;
}

interface AlertPayload {
  site_id: number;
  alert_type: string;
  severity: string;
  keyword: string;
  message: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Check A — Position drops (>= 5 positions in 7d vs previous 7d)
// ---------------------------------------------------------------------------

/**
 * Position drops sur 7j vs 7j-precedents.
 *
 * Filtre bruit :
 * - drop >= 5 positions
 * - keyword avec >= 30 impressions cumulees sur la fenetre 14j
 *   (sinon bruit pur : KW long-tail ou hors-perimetre langues)
 * - position de depart <= 60 (chuter de 80 -> 90 n'est pas exploitable)
 */
async function checkPositionDrops(
  sql: ReturnType<typeof getSQL>,
  siteId: number
): Promise<PositionDrop[]> {
  const rows = (await sql`
    WITH current_week AS (
      SELECT query,
             AVG(position) AS avg_pos,
             SUM(impressions) AS impressions
      FROM search_console_data
      WHERE site_id = ${siteId}
        AND date >= CURRENT_DATE - INTERVAL '7 days'
        AND position IS NOT NULL
      GROUP BY query
    ),
    previous_week AS (
      SELECT query,
             AVG(position) AS avg_pos,
             SUM(impressions) AS impressions
      FROM search_console_data
      WHERE site_id = ${siteId}
        AND date >= CURRENT_DATE - INTERVAL '14 days'
        AND date < CURRENT_DATE - INTERVAL '7 days'
        AND position IS NOT NULL
      GROUP BY query
    )
    SELECT cw.query   AS keyword,
           pw.avg_pos AS prev_avg,
           cw.avg_pos AS curr_avg,
           (cw.avg_pos - pw.avg_pos) AS drop
    FROM current_week cw
    INNER JOIN previous_week pw ON pw.query = cw.query
    WHERE (cw.avg_pos - pw.avg_pos) >= 5
      AND (COALESCE(cw.impressions, 0) + COALESCE(pw.impressions, 0)) >= 30
      AND pw.avg_pos <= 60
    ORDER BY (cw.avg_pos - pw.avg_pos) DESC
    LIMIT 50
  `) as PositionDrop[];

  return rows;
}

// ---------------------------------------------------------------------------
// Check B — Indexation failures (published > 48h, HTTP != 200)
// ---------------------------------------------------------------------------

interface AutopilotRow {
  id: number;
  keyword: string;
  github_url: string;
  published_url: string | null;
  language: string;
  created_at: string;
}

async function checkIndexation(
  sql: ReturnType<typeof getSQL>,
  siteId: number,
  siteUrl: string,
  siteName: string
): Promise<UnindexedArticle[]> {
  const runs = (await sql`
    SELECT id, keyword, github_url, published_url,
           COALESCE(language, 'fr') AS language,
           created_at
    FROM autopilot_runs
    WHERE site_id = ${siteId}
      AND status = 'published'
      AND github_url IS NOT NULL
      AND created_at < NOW() - INTERVAL '48 hours'
    ORDER BY created_at DESC
    LIMIT 50
  `) as AutopilotRow[];

  const failures: UnindexedArticle[] = [];

  for (const run of runs) {
    // Source de vérité = published_url stockée au moment de la publication.
    // Reconstruire via resolvePublishedArticleLiveUrl peut échouer si la config
    // de mapping (publicUrlOverride, prefix match) a changé depuis la création.
    const liveUrl = run.published_url ?? resolvePublishedArticleLiveUrl({
      siteUrl,
      siteName,
      keyword: run.keyword,
      language: run.language,
      createdAt: run.created_at,
    });

    let statusCode: number | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(liveUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timeout);
      statusCode = res.status;
    } catch {
      statusCode = null;
    }

    if (statusCode !== 200) {
      failures.push({
        run_id: run.id,
        keyword: run.keyword,
        live_url: liveUrl,
        status_code: statusCode,
      });
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Store alerts
// ---------------------------------------------------------------------------

async function ensureAlertsTable(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS seo_alerts (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      alert_type VARCHAR(50),
      severity VARCHAR(20),
      keyword VARCHAR(500),
      message TEXT,
      data JSONB,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_seo_alerts_site ON seo_alerts(site_id, created_at DESC)`;
  // Bucket par jour : une alerte par (site, type, keyword) et par jour calendaire UTC.
  // Empeche les doublons quand le cron est trigger plusieurs fois le meme jour.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_alerts_dedup
    ON seo_alerts (site_id, alert_type, keyword, (created_at::date))
  `;
}

async function insertAlerts(
  sql: ReturnType<typeof getSQL>,
  alerts: AlertPayload[]
): Promise<void> {
  for (const a of alerts) {
    await sql`
      INSERT INTO seo_alerts (site_id, alert_type, severity, keyword, message, data)
      VALUES (${a.site_id}, ${a.alert_type}, ${a.severity}, ${a.keyword}, ${a.message}, ${JSON.stringify(a.data)})
      ON CONFLICT (site_id, alert_type, keyword, (created_at::date))
      DO UPDATE SET severity = EXCLUDED.severity,
                    message = EXCLUDED.message,
                    data = EXCLUDED.data
    `;
  }
}

// ---------------------------------------------------------------------------
// Email via Resend
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AI executive summary
// ---------------------------------------------------------------------------
async function generateAiSummary(alerts: AlertPayload[], sites: SiteRow[]): Promise<string> {
  if (alerts.length === 0) return "";
  const siteMap = new Map(sites.map((s) => [s.id, s.name]));
  const condensed = alerts.slice(0, 20).map((a) =>
    `- [${a.severity.toUpperCase()}] ${siteMap.get(a.site_id) ?? "?"} / "${a.keyword}" → ${a.message}`
  ).join("\n");

  try {
    return await askAI(
      [
        { role: "system", content: "Tu es un Head of SEO. Tu reçois les alertes du jour. Tu rédiges un résumé exécutif ULTRA-COURT (max 6 lignes) en français : 1) gravité globale (rouge/orange/vert), 2) priorité n°1 à régler aujourd'hui, 3) qui appeler. Marqueurs 🔴 🟡 🟢 🚀." },
        { role: "user", content: `Alertes SEO du jour (${alerts.length} au total) :\n${condensed}` },
      ],
      "smart",
      400
    );
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Slack webhook
// ---------------------------------------------------------------------------
async function sendAlertSlack(alerts: AlertPayload[], sites: SiteRow[], aiSummary: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook || alerts.length === 0) return;

  const siteMap = new Map(sites.map((s) => [s.id, s.name]));
  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warning = alerts.filter((a) => a.severity === "warning").length;

  const lines = alerts.slice(0, 10).map((a) => {
    const badge = a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "🔵";
    return `${badge} *${siteMap.get(a.site_id) ?? "?"}* / \`${a.keyword}\` — ${a.message}`;
  }).join("\n");

  const blocks = [
    { type: "header", text: { type: "plain_text", text: `🚨 SEO Alerts — ${alerts.length} (🔴 ${critical} / 🟡 ${warning})` } },
    ...(aiSummary ? [{ type: "section", text: { type: "mrkdwn", text: `*🤖 IA Head of SEO :*\n${aiSummary}` } }] : []),
    { type: "section", text: { type: "mrkdwn", text: lines } },
    ...(alerts.length > 10 ? [{ type: "context", elements: [{ type: "mrkdwn", text: `+${alerts.length - 10} autres alertes (voir email/dashboard)` }] }] : []),
  ];

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks, text: `${alerts.length} alertes SEO` }),
    });
  } catch (err) {
    console.error("Slack webhook failed:", err);
  }
}

async function sendAlertEmail(alerts: AlertPayload[], sites: SiteRow[], aiSummary: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.ALERT_EMAIL;
  if (!resendKey || !alertEmail || alerts.length === 0) return;

  const siteMap = new Map(sites.map((s) => [s.id, s.name]));

  const rows = alerts
    .map((a) => {
      const siteName = siteMap.get(a.site_id) ?? `Site #${a.site_id}`;
      const badge = a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "🔵";
      return `<tr>
        <td>${badge} ${a.severity.toUpperCase()}</td>
        <td>${siteName}</td>
        <td>${a.alert_type}</td>
        <td>${a.keyword}</td>
        <td>${a.message}</td>
      </tr>`;
    })
    .join("");

  const aiBlock = aiSummary
    ? `<div style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;margin-bottom:18px;font-family:sans-serif;font-size:13px;line-height:1.6;border-left:4px solid #3b82f6">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#60a5fa;font-weight:bold;margin-bottom:8px">🤖 IA Head of SEO</div>
        <div style="white-space:pre-wrap">${aiSummary.replace(/</g, "&lt;")}</div>
      </div>`
    : "";

  const html = `
<h2>🚨 SEO Alerts — ${alerts.length} issue(s) detected</h2>
${aiBlock}
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
  <thead><tr><th>Severity</th><th>Site</th><th>Type</th><th>Keyword</th><th>Details</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p style="color:#888;font-size:11px">SEO Dashboard Alerts — ${new Date().toISOString().slice(0, 10)}</p>
  `.trim();

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "SEO Dashboard <onboarding@resend.dev>",
        to: [alertEmail],
        subject: `🚨 SEO Alerts — ${alerts.length} issue(s) detected`,
        html,
      }),
    });
  } catch (err) {
    console.error("Failed to send alert email:", err);
  }
}

// ---------------------------------------------------------------------------
// POST handler (cron-triggered)
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const sql = getSQL();

  try {
    await ensureAlertsTable(sql);

    const sites = (await sql`
      SELECT id, name, url FROM sites WHERE is_active = true ORDER BY id
    `) as SiteRow[];

    if (sites.length === 0) {
      return NextResponse.json({ success: true, message: "No active sites", alerts: 0 });
    }

    const allAlerts: AlertPayload[] = [];

    for (const site of sites) {
      // A) Position drops
      const drops = await checkPositionDrops(sql, site.id);
      for (const d of drops) {
        const severity = d.drop >= 10 ? "critical" : "warning";
        allAlerts.push({
          site_id: site.id,
          alert_type: "position_drop",
          severity,
          keyword: d.keyword,
          message: `Lost ${Math.round(d.drop)} positions (${Math.round(d.prev_avg)} → ${Math.round(d.curr_avg)})`,
          data: { prev_avg: d.prev_avg, curr_avg: d.curr_avg, drop: d.drop },
        });
      }

      // B) Indexation failures
      const failures = await checkIndexation(sql, site.id, site.url, site.name);
      for (const f of failures) {
        allAlerts.push({
          site_id: site.id,
          alert_type: "not_indexed",
          severity: "critical",
          keyword: f.keyword,
          message: `Article not accessible (HTTP ${f.status_code ?? "timeout"}) — ${f.live_url}`,
          data: { run_id: f.run_id, live_url: f.live_url, status_code: f.status_code },
        });
      }

      // C) Competitor gains — skipped (no history table yet)
    }

    // Persist
    await insertAlerts(sql, allAlerts);

    // AI exec summary (used by both email + Slack)
    const aiSummary = await generateAiSummary(allAlerts, sites);

    // Email + Slack in parallel
    await Promise.all([
      sendAlertEmail(allAlerts, sites, aiSummary),
      sendAlertSlack(allAlerts, sites, aiSummary),
    ]);

    return NextResponse.json({
      success: true,
      total_sites: sites.length,
      alerts: allAlerts.length,
      by_type: {
        position_drop: allAlerts.filter((a) => a.alert_type === "position_drop").length,
        not_indexed: allAlerts.filter((a) => a.alert_type === "not_indexed").length,
      },
      ai_summary: aiSummary || null,
      slack: !!process.env.SLACK_WEBHOOK_URL,
      email: !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alert check error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
