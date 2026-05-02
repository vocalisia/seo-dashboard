export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";

interface SiteWeekStats {
  site_id: number;
  site_name: string;
  site_url: string;
  clicks_now: number;
  clicks_prev: number;
  clicks_delta_pct: number;
  impressions_now: number;
  impressions_prev: number;
  position_now: number;
  position_prev: number;
  top_gains: Array<{ query: string; gain: number; position: number; clicks: number }>;
  top_losses: Array<{ query: string; gain: number; position: number; clicks: number }>;
}

async function getSiteStats(sql: ReturnType<typeof getSQL>, siteId: number, siteName: string, siteUrl: string): Promise<SiteWeekStats> {
  const now = (await sql`
    SELECT
      COALESCE(SUM(clicks), 0)::int AS clicks,
      COALESCE(SUM(impressions), 0)::int AS impressions,
      COALESCE(AVG(NULLIF(position, 0)), 0)::numeric AS position
    FROM search_console_data
    WHERE site_id = ${siteId}
      AND date >= CURRENT_DATE - 7
  `)[0] as { clicks: number; impressions: number; position: string };

  const prev = (await sql`
    SELECT
      COALESCE(SUM(clicks), 0)::int AS clicks,
      COALESCE(SUM(impressions), 0)::int AS impressions,
      COALESCE(AVG(NULLIF(position, 0)), 0)::numeric AS position
    FROM search_console_data
    WHERE site_id = ${siteId}
      AND date >= CURRENT_DATE - 14
      AND date <  CURRENT_DATE - 7
  `)[0] as { clicks: number; impressions: number; position: string };

  // Top gains/losses on position
  const gainsRows = await sql`
    WITH w0 AS (
      SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
      FROM search_console_data
      WHERE site_id = ${siteId} AND date >= CURRENT_DATE - 7 AND query IS NOT NULL
      GROUP BY query
    ), w1 AS (
      SELECT query, AVG(position) AS pos
      FROM search_console_data
      WHERE site_id = ${siteId} AND date >= CURRENT_DATE - 14 AND date < CURRENT_DATE - 7 AND query IS NOT NULL
      GROUP BY query
    )
    SELECT w0.query,
      ROUND((w1.pos - w0.pos)::numeric, 1) AS gain,
      ROUND(w0.pos::numeric, 1) AS position,
      w0.clicks::int AS clicks
    FROM w0 LEFT JOIN w1 ON w1.query = w0.query
    WHERE w1.pos IS NOT NULL AND ABS(w1.pos - w0.pos) >= 2
    ORDER BY (w1.pos - w0.pos) DESC NULLS LAST
    LIMIT 20
  `;

  const all = gainsRows as Array<{ query: string; gain: string; position: string; clicks: number }>;
  const gainsList = all.map((r) => ({
    query: r.query,
    gain: Number(r.gain),
    position: Number(r.position),
    clicks: r.clicks,
  }));

  const clicksNow = Number(now.clicks);
  const clicksPrev = Number(prev.clicks);
  const deltaPct = clicksPrev > 0 ? ((clicksNow - clicksPrev) / clicksPrev) * 100 : 0;

  return {
    site_id: siteId,
    site_name: siteName,
    site_url: siteUrl,
    clicks_now: clicksNow,
    clicks_prev: clicksPrev,
    clicks_delta_pct: Math.round(deltaPct * 10) / 10,
    impressions_now: Number(now.impressions),
    impressions_prev: Number(prev.impressions),
    position_now: Math.round(Number(now.position) * 10) / 10,
    position_prev: Math.round(Number(prev.position) * 10) / 10,
    top_gains: gainsList.filter((g) => g.gain > 0).slice(0, 5),
    top_losses: gainsList.filter((g) => g.gain < 0).reverse().slice(0, 5),
  };
}

async function generateExecSummary(stats: SiteWeekStats[]): Promise<string> {
  const totalClicks = stats.reduce((s, x) => s + x.clicks_now, 0);
  const totalPrev = stats.reduce((s, x) => s + x.clicks_prev, 0);
  const deltaPct = totalPrev > 0 ? ((totalClicks - totalPrev) / totalPrev) * 100 : 0;

  const winners = stats.filter((s) => s.clicks_delta_pct > 5).slice(0, 3);
  const losers = stats.filter((s) => s.clicks_delta_pct < -5).slice(0, 3);

  const summary = `Portefeuille (${stats.length} sites) :
- Clics totaux semaine : ${totalClicks.toLocaleString('fr-FR')} (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs S-1)
- Impressions totales : ${stats.reduce((s, x) => s + x.impressions_now, 0).toLocaleString('fr-FR')}
- Sites en croissance : ${winners.map((w) => `${w.site_name} (+${w.clicks_delta_pct}%)`).join(", ") || "aucun"}
- Sites en déclin : ${losers.map((l) => `${l.site_name} (${l.clicks_delta_pct}%)`).join(", ") || "aucun"}`;

  try {
    return await askAI(
      [
        { role: "system", content: "Tu es CEO d'une agence SEO. Tu rédiges l'executive summary du rapport hebdo (max 250 mots, français). Structure stricte: 1) verdict global (3 lignes), 2) 3 wins de la semaine, 3) 3 risques à surveiller, 4) priorité semaine prochaine. Ton: factuel, chiffré, actionnable. Marqueurs ✅ ⚠️ 🎯." },
        { role: "user", content: summary },
      ],
      "smart",
      800
    );
  } catch (e) {
    return `Erreur IA : ${e instanceof Error ? e.message : "unknown"}`;
  }
}

function buildHTML(stats: SiteWeekStats[], execSummary: string): string {
  const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const totalClicks = stats.reduce((s, x) => s + x.clicks_now, 0);
  const totalImpr = stats.reduce((s, x) => s + x.impressions_now, 0);
  const totalDelta = stats.reduce((s, x) => s + x.clicks_now, 0) - stats.reduce((s, x) => s + x.clicks_prev, 0);
  const totalDeltaPct = stats.reduce((s, x) => s + x.clicks_prev, 0) > 0
    ? Math.round((totalDelta / stats.reduce((s, x) => s + x.clicks_prev, 0)) * 1000) / 10
    : 0;

  const sitesHtml = stats
    .sort((a, b) => b.clicks_now - a.clicks_now)
    .map((s) => {
      const deltaColor = s.clicks_delta_pct > 0 ? "#10b981" : s.clicks_delta_pct < 0 ? "#ef4444" : "#94a3b8";
      const gainsHtml = s.top_gains.map((g) => `<li style="color:#10b981">+${g.gain.toFixed(1)} → ${g.query} (pos ${g.position})</li>`).join("");
      const lossesHtml = s.top_losses.map((l) => `<li style="color:#ef4444">${l.gain.toFixed(1)} → ${l.query} (pos ${l.position})</li>`).join("");
      return `
        <div class="site-card">
          <h3>${s.site_name} <span style="color:#94a3b8;font-weight:400;font-size:13px">${s.site_url}</span></h3>
          <div class="kpi-row">
            <div><b>${s.clicks_now.toLocaleString('fr-FR')}</b><br><span class="lbl">clics 7j</span><br><span style="color:${deltaColor};font-size:12px">${s.clicks_delta_pct >= 0 ? "+" : ""}${s.clicks_delta_pct}%</span></div>
            <div><b>${s.impressions_now.toLocaleString('fr-FR')}</b><br><span class="lbl">impressions</span></div>
            <div><b>${s.position_now}</b><br><span class="lbl">position moy.</span></div>
          </div>
          <div class="kw-cols">
            <div><h4>📈 Gains</h4><ul>${gainsHtml || "<li style='color:#64748b'>—</li>"}</ul></div>
            <div><h4>📉 Pertes</h4><ul>${lossesHtml || "<li style='color:#64748b'>—</li>"}</ul></div>
          </div>
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport SEO hebdo — ${date}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.55;padding:32px;max-width:1100px;margin:0 auto}
  h1{color:#fff;font-size:32px;margin-bottom:6px}
  h2{color:#3b82f6;font-size:22px;margin:32px 0 14px;border-bottom:2px solid #1e293b;padding-bottom:8px}
  h3{color:#fff;font-size:18px;margin-bottom:10px}
  h4{color:#3b82f6;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .header-meta{color:#94a3b8;margin-bottom:32px}
  .exec-summary{background:linear-gradient(135deg,#1e293b,#0f172a);border-left:4px solid #3b82f6;padding:24px;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.7}
  .global-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}
  .kpi-card{background:#1e293b;padding:18px;border-radius:8px;border:1px solid #334155}
  .kpi-card .num{font-size:28px;font-weight:bold;color:#fff}
  .kpi-card .lbl{color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px}
  .site-card{background:#1e293b;padding:20px;border-radius:8px;border:1px solid #334155;margin-bottom:18px}
  .kpi-row{display:flex;gap:32px;margin:14px 0;font-size:14px}
  .kpi-row b{font-size:22px;color:#fff}
  .kpi-row .lbl{color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1px}
  .kw-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:14px;font-size:13px}
  .kw-cols ul{list-style:none}
  .kw-cols li{padding:4px 0;border-bottom:1px solid #334155}
  .footer{margin-top:32px;color:#64748b;font-size:11px;text-align:center;border-top:1px solid #1e293b;padding-top:18px}
  @media print {
    body{background:#fff;color:#0f172a;padding:16px}
    h1,h3{color:#0f172a} h4{color:#3b82f6}
    .exec-summary{background:#f1f5f9;color:#0f172a}
    .global-kpis .kpi-card,.site-card{background:#f8fafc;border:1px solid #e2e8f0;color:#0f172a}
    .kpi-card .num,.kpi-row b{color:#0f172a}
    .kw-cols li{border-bottom:1px solid #e2e8f0}
  }
</style>
</head>
<body>
<h1>📊 Rapport SEO hebdomadaire</h1>
<div class="header-meta">${date} · Portefeuille de ${stats.length} sites · Période 7j vs S-1</div>

<h2>🎯 Executive Summary (IA)</h2>
<div class="exec-summary">${execSummary.replace(/</g, "&lt;")}</div>

<h2>📈 KPIs globaux</h2>
<div class="global-kpis">
  <div class="kpi-card"><div class="num">${totalClicks.toLocaleString('fr-FR')}</div><div class="lbl">Clics 7j</div><div style="color:${totalDeltaPct >= 0 ? "#10b981" : "#ef4444"};font-size:13px;margin-top:4px">${totalDeltaPct >= 0 ? "+" : ""}${totalDeltaPct}% vs S-1</div></div>
  <div class="kpi-card"><div class="num">${totalImpr.toLocaleString('fr-FR')}</div><div class="lbl">Impressions 7j</div></div>
  <div class="kpi-card"><div class="num">${stats.length}</div><div class="lbl">Sites suivis</div></div>
</div>

<h2>🔍 Détail par site</h2>
${sitesHtml}

<div class="footer">SEO Dashboard — Généré ${new Date().toLocaleString("fr-FR")} · Imprimer (Cmd/Ctrl + P) pour PDF</div>
</body>
</html>`;
}

export async function GET() {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  const sql = getSQL();
  const sites = (await sql`
    SELECT id, name, url FROM sites WHERE is_active = true ORDER BY name
  `) as Array<{ id: number; name: string; url: string }>;

  const stats: SiteWeekStats[] = [];
  for (const s of sites) {
    try {
      stats.push(await getSiteStats(sql, s.id, s.name, s.url));
    } catch (e) {
      console.error(`Stats failed for ${s.name}:`, e);
    }
  }

  const execSummary = await generateExecSummary(stats);
  const html = buildHTML(stats, execSummary);

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
