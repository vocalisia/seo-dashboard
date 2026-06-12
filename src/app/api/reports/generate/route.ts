import { getSQL, initDB } from "@/lib/db";
import { NextResponse } from "next/server";
import { askAICached } from "@/lib/ai-cache";
import { requireCronOrUser } from "@/lib/cron-auth";
import { GSC_LAG_DAYS } from "@/lib/gsc-window";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface SiteRow {
  id: number;
  name: string;
  url: string;
}

interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
  source_volume: number;
  volume_source: string | null;
  volume_status: "imported" | "missing";
}

interface GainRow {
  query: string;
  gain: number;
  position_now: number;
  clicks_now: number;
  clicks_prev: number;
  source_volume: number;
  volume_source: string | null;
  volume_status: "imported" | "missing";
}

interface OpportunityRow extends QueryRow {
  reason: string;
  priority_score: number;
  data_source: "gsc_query_data";
}

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveSourceVolume(row: Record<string, unknown>): { sourceVolume: number; volumeSource: string | null; volumeStatus: "imported" | "missing" } {
  const raw = numeric(row.volume_market ?? row.volume_ch ?? row.volume_fr);
  const source = typeof row.volume_source === "string" && row.volume_source.trim() ? row.volume_source : null;
  const isImported = source !== null && !source.includes("niche_skip") && raw > 1;
  return {
    sourceVolume: isImported ? raw : 0,
    volumeSource: source,
    volumeStatus: isImported ? "imported" : "missing",
  };
}

function mapQueryRow(row: Record<string, unknown>): QueryRow {
  const volume = resolveSourceVolume(row);
  return {
    query: String(row.query ?? ""),
    clicks: numeric(row.clicks),
    impressions: numeric(row.impressions),
    position: numeric(row.position),
    ctr: numeric(row.ctr),
    source_volume: volume.sourceVolume,
    volume_source: volume.volumeSource,
    volume_status: volume.volumeStatus,
  };
}

function mapGainRow(row: Record<string, unknown>): GainRow {
  const volume = resolveSourceVolume(row);
  return {
    query: String(row.query ?? ""),
    gain: numeric(row.gain),
    position_now: numeric(row.position_now),
    clicks_now: numeric(row.clicks_now),
    clicks_prev: numeric(row.clicks_prev),
    source_volume: volume.sourceVolume,
    volume_source: volume.volumeSource,
    volume_status: volume.volumeStatus,
  };
}

function buildOpportunities(rows: QueryRow[]): OpportunityRow[] {
  return rows
    .filter((q) => q.position >= 4 && q.position <= 30 && q.impressions > 0)
    .map((q) => {
      const positionBoost = q.position <= 10 ? 1.5 : q.position <= 20 ? 1.2 : 0.85;
      const volumeBase = q.source_volume > 0 ? q.source_volume : q.impressions;
      const priorityScore = Math.round((volumeBase * positionBoost) + (q.clicks * 20) + (q.impressions * 0.25));
      const reason = q.source_volume > 0
        ? "Position GSC proche + volume importe disponible"
        : "Position GSC proche, volume a importer avant decision forte";
      return {
        ...q,
        reason,
        priority_score: priorityScore,
        data_source: "gsc_query_data" as const,
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 8);
}

function buildFallbackReport(weekStart: string, data: {
  gscWindow: { start: string; end: string };
  topQueries: QueryRow[];
  gains: GainRow[];
  losses: GainRow[];
  opportunities: OpportunityRow[];
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
}) {
  const gainText = data.gains
    .slice(0, 3)
    .map((g) => `${g.query} (+${g.gain.toFixed(1)} -> pos ${g.position_now.toFixed(1)}, ${g.clicks_now} clics)`)
    .join(", ");
  const lossText = data.losses
    .slice(0, 3)
    .map((g) => `${g.query} (${g.gain.toFixed(1)} -> pos ${g.position_now.toFixed(1)}, ${g.clicks_now} clics)`)
    .join(", ");
  const oppText = data.opportunities
    .slice(0, 3)
    .map((o) => {
      const volume = o.source_volume > 0 ? `, volume importe ${o.source_volume}` : ", volume non importe";
      return `${o.query} (pos ${o.position.toFixed(1)}, ${o.clicks} clics, ${o.impressions} impr.${volume})`;
    })
    .join(", ");
  const importedVolumeCount = data.topQueries.filter((q) => q.source_volume > 0).length;

  return [
    `Resume semaine du ${weekStart}: ${data.totalClicks} clics, ${data.totalImpressions} impressions, position moyenne ${data.avgPosition.toFixed(1)}.`,
    `Source: Search Console query-level du ${data.gscWindow.start} au ${data.gscWindow.end}. Volumes importes disponibles sur ${importedVolumeCount}/${data.topQueries.length} mots cles visibles.`,
    gainText ? `Progressions: ${gainText}.` : "Progressions: aucune hausse significative detectee.",
    lossText ? `Replis: ${lossText}.` : "Replis: aucune baisse significative detectee.",
    oppText ? `Priorites: ${oppText}.` : "Priorites: consolider les pages deja visibles et importer les volumes manquants.",
  ].join("\n\n");
}

async function sendWeeklyReportsEmail(
  weekStart: string,
  results: Array<{ site: string; status: string; clicks?: number; error?: string }>,
) {
  const resendKey = process.env.RESEND_API_KEY?.replace(/\\n/g, "").trim();
  const alertEmail = process.env.ALERT_EMAIL?.replace(/\\n/g, "").trim();
  const fromEmail = process.env.REPORTS_FROM_EMAIL?.replace(/\\n/g, "").trim() || "contact@job-emploi.ch";
  if (!resendKey || !alertEmail) return;

  const ok = results.filter((r) => r.status === "ok");
  const noData = results.filter((r) => r.status === "no_data");
  const failed = results.filter((r) => r.status === "error");
  const totalClicks = ok.reduce((sum, r) => sum + Number(r.clicks ?? 0), 0);

  const html = `
<h2>Rapport SEO hebdomadaire</h2>
<p>Semaine du ${weekStart} - ${ok.length} site(s) analyse(s), ${totalClicks} clics cumules.</p>

${ok.length > 0 ? `<h3>Sites analyses (${ok.length})</h3>
<ul>${ok.map((r) => `<li><strong>${r.site}</strong> - ${Number(r.clicks ?? 0)} clics</li>`).join("")}</ul>` : ""}

${noData.length > 0 ? `<h3>Sans donnees (${noData.length})</h3>
<ul>${noData.map((r) => `<li><strong>${r.site}</strong></li>`).join("")}</ul>` : ""}

${failed.length > 0 ? `<h3>Echecs (${failed.length})</h3>
<ul>${failed.map((r) => `<li><strong>${r.site}</strong> - ${r.error ?? "Erreur inconnue"}</li>`).join("")}</ul>` : ""}

<p style="color:#888;font-size:12px">SEO Dashboard - ${new Date().toLocaleString("fr-FR")}</p>
  `.trim();

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `SEO Dashboard <${fromEmail}>`,
        to: [alertEmail],
        subject: `Rapport SEO hebdo - ${ok.length} site(s) analyses`,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("Failed to send weekly reports email:", err);
  }
}

async function analyzeWithAI(
  siteId: number,
  weekStart: string,
  siteName: string,
  siteUrl: string,
  data: {
    topQueries: { query: string; clicks: number; impressions: number; position: number }[];
    gains: GainRow[];
    losses: GainRow[];
    opportunities: OpportunityRow[];
    gscWindow: { start: string; end: string };
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
  },
) {
  const prompt = `Tu es un expert SEO. Analyse les donnees Google Search Console de la semaine pour le site "${siteName}" (${siteUrl}) et genere un rapport actionnable en francais.

REGLES STRICTES:
- Positions, clics et impressions viennent de Google Search Console query-level.
- Fenetre analysee: du ${data.gscWindow.start} au ${data.gscWindow.end}, en excluant les jours non finalises GSC.
- Ne jamais inventer de volume. Si source_volume = 0, ecrire "volume non importe" et recommander d'importer le volume avant decision forte.
- Les volumes disponibles viennent uniquement de tracked_keywords / import Keyword Planner.

## Donnees de la semaine :
- Clics totaux : ${data.totalClicks}
- Impressions totales : ${data.totalImpressions}
- Position moyenne : ${data.avgPosition.toFixed(1)}

## Top 10 mots cles GSC :
${data.topQueries.slice(0, 10).map((q) => `- "${q.query}" : pos ${q.position.toFixed(1)}, ${q.clicks} clics, ${q.impressions} impressions`).join("\n")}

## Gains de position cette semaine (top 5) :
${data.gains.slice(0, 5).map((g) => `- "${g.query}" : +${g.gain} positions -> pos ${g.position_now}, ${g.clicks_now} clics, ${g.source_volume > 0 ? `volume importe ${g.source_volume}` : "volume non importe"}`).join("\n") || "Aucun gain significatif"}

## Pertes de position cette semaine (top 5) :
${data.losses.slice(0, 5).map((g) => `- "${g.query}" : ${g.gain} positions -> pos ${g.position_now}, ${g.clicks_now} clics, ${g.source_volume > 0 ? `volume importe ${g.source_volume}` : "volume non importe"}`).join("\n") || "Aucune perte significative"}

## Priorites mots cles :
${data.opportunities.slice(0, 8).map((q) => `- "${q.query}" : pos ${q.position.toFixed(1)}, ${q.clicks} clics, ${q.impressions} impressions, ${q.source_volume > 0 ? `volume importe ${q.source_volume}` : "volume non importe"}, raison: ${q.reason}`).join("\n") || "Aucune"}

Genere un rapport structure avec :
1. Resume de la semaine (2-3 phrases)
2. Actions prioritaires (3-5 actions concretes avec quel contenu creer/optimiser et pour quel mot cle)
3. Textes SEO a produire (titre d'article ou de page + mot cle cible + pourquoi maintenant)

Sois tres concret et actionnable. Format markdown.`;

  const { reply } = await askAICached({
    cacheKey: `reports:${siteId}:weekly:${weekStart}`,
    messages: [{ role: "user", content: prompt }],
    model: "search",
    maxTokens: 1200,
  });
  return reply;
}

export async function POST(request: Request) {
  const cronUnauthorized = await requireCronOrUser(request);
  if (cronUnauthorized) {
    const { requireApiSession } = await import("@/lib/api-auth");
    const auth = await requireApiSession();
    if (auth.unauthorized) return auth.unauthorized;
  }

  try {
    await initDB();
    const sql = getSQL();

    let requestedSiteId: number | null = null;
    try {
      const body = (await request.json()) as { site_id?: unknown };
      if (typeof body.site_id === "number" && Number.isFinite(body.site_id)) {
        requestedSiteId = Math.floor(body.site_id);
      }
    } catch {
      // Cron calls can send an empty body. Generate all sites in that case.
    }

    const sites = requestedSiteId
      ? await sql`SELECT id, name, url FROM sites WHERE is_active = true AND id = ${requestedSiteId}`
      : await sql`SELECT id, name, url FROM sites WHERE is_active = true`;
    const isBulkRun = requestedSiteId === null;

    if (requestedSiteId && sites.length === 0) {
      return NextResponse.json({ success: false, error: "Site introuvable ou inactif" }, { status: 404 });
    }

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const results: Array<{ site: string; status: string; clicks?: number; error?: string }> = [];

    for (const site of sites as SiteRow[]) {
      try {
        const windowRows = await sql`
          SELECT
            (CURRENT_DATE - INTERVAL '1 day' * (6 + ${GSC_LAG_DAYS}))::date::text AS start_date,
            (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date::text AS end_date
        `;
        const gscWindow = {
          start: String(windowRows[0]?.start_date ?? ""),
          end: String(windowRows[0]?.end_date ?? ""),
        };

        const topQueries = await sql`
          SELECT
            scq.query,
            SUM(scq.clicks)::int AS clicks,
            SUM(scq.impressions)::int AS impressions,
            (SUM(scq.impressions * scq.position)::float / NULLIF(SUM(scq.impressions), 0)) AS position,
            (SUM(scq.clicks)::float / NULLIF(SUM(scq.impressions), 0)) AS ctr,
            MAX(tk.volume_market)::int AS volume_market,
            MAX(tk.volume_fr)::int AS volume_fr,
            MAX(tk.volume_ch)::int AS volume_ch,
            MAX(tk.volume_source)::varchar AS volume_source
          FROM search_console_query_data scq
          LEFT JOIN tracked_keywords tk
            ON tk.site_id = scq.site_id
           AND LOWER(tk.keyword) = LOWER(scq.query)
           AND tk.is_active = TRUE
          WHERE scq.site_id = ${site.id}
            AND scq.date >= (CURRENT_DATE - INTERVAL '1 day' * (6 + ${GSC_LAG_DAYS}))::date
            AND scq.date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
            AND scq.query IS NOT NULL
          GROUP BY scq.query
          ORDER BY SUM(scq.clicks) DESC, SUM(scq.impressions) DESC
          LIMIT 50
        `;

        if (topQueries.length === 0) {
          results.push({ site: site.name, status: "no_data" });
          continue;
        }

        const gainRows = await sql`
          WITH cur AS (
            SELECT
              query,
              (SUM(impressions * position)::float / NULLIF(SUM(impressions), 0)) AS pos_now,
              SUM(clicks)::int AS clicks_now
            FROM search_console_query_data
            WHERE site_id = ${site.id}
              AND date >= (CURRENT_DATE - INTERVAL '1 day' * (6 + ${GSC_LAG_DAYS}))::date
              AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
              AND query IS NOT NULL
            GROUP BY query
          ),
          prev AS (
            SELECT
              query,
              (SUM(impressions * position)::float / NULLIF(SUM(impressions), 0)) AS pos_prev,
              SUM(clicks)::int AS clicks_prev
            FROM search_console_query_data
            WHERE site_id = ${site.id}
              AND date >= (CURRENT_DATE - INTERVAL '1 day' * (13 + ${GSC_LAG_DAYS}))::date
              AND date <= (CURRENT_DATE - INTERVAL '1 day' * (7 + ${GSC_LAG_DAYS}))::date
              AND query IS NOT NULL
            GROUP BY query
          )
          SELECT c.query,
            ROUND((p.pos_prev - c.pos_now)::numeric, 1) as gain,
            ROUND(c.pos_now::numeric, 1) as position_now,
            c.clicks_now,
            p.clicks_prev,
            MAX(tk.volume_market)::int AS volume_market,
            MAX(tk.volume_fr)::int AS volume_fr,
            MAX(tk.volume_ch)::int AS volume_ch,
            MAX(tk.volume_source)::varchar AS volume_source
          FROM cur c JOIN prev p ON p.query = c.query
          LEFT JOIN tracked_keywords tk
            ON tk.site_id = ${site.id}
           AND LOWER(tk.keyword) = LOWER(c.query)
           AND tk.is_active = TRUE
          WHERE ABS(p.pos_prev - c.pos_now) > 0.5
          GROUP BY c.query, c.pos_now, p.pos_prev, c.clicks_now, p.clicks_prev
          ORDER BY gain DESC, c.clicks_now DESC
          LIMIT 20
        `;

        const queryRows = (topQueries as Record<string, unknown>[]).map(mapQueryRow);
        const gains = (gainRows as Record<string, unknown>[]).filter((g) => Number(g.gain) > 0).map(mapGainRow);
        const losses = (gainRows as Record<string, unknown>[]).filter((g) => Number(g.gain) < 0).map(mapGainRow);

        const totalClicks = queryRows.reduce((s, q) => s + q.clicks, 0);
        const totalImpressions = queryRows.reduce((s, q) => s + q.impressions, 0);
        const avgPos = totalImpressions > 0
          ? queryRows.reduce((s, q) => s + (q.position * q.impressions), 0) / totalImpressions
          : queryRows.reduce((s, q) => s + q.position, 0) / queryRows.length;
        const importedVolumeCount = queryRows.filter((q) => q.source_volume > 0).length;
        const opportunities = buildOpportunities(queryRows);

        const fallbackReport = buildFallbackReport(weekStartStr, {
          gscWindow,
          topQueries: queryRows,
          gains,
          losses,
          opportunities,
          totalClicks,
          totalImpressions,
          avgPosition: avgPos,
        });

        const aiReport = isBulkRun
          ? fallbackReport
          : await Promise.race([
              analyzeWithAI(site.id, weekStartStr, site.name, site.url, {
                topQueries: queryRows,
                gains,
                losses,
                opportunities,
                gscWindow,
                totalClicks,
                totalImpressions,
                avgPosition: avgPos,
              }),
              new Promise<string>((_, reject) => setTimeout(() => reject(new Error("AI timeout")), 20_000)),
            ]).catch(() => fallbackReport);

        await sql`
          INSERT INTO weekly_reports (site_id, week_start, summary, recommendations, top_opportunities)
          VALUES (
            ${site.id}, ${weekStartStr},
            ${`GSC query-level ${gscWindow.start} -> ${gscWindow.end} - ${totalClicks} clics, ${totalImpressions} impressions, position moy. ${avgPos.toFixed(1)}, volumes importes ${importedVolumeCount}/${queryRows.length}`},
            ${aiReport || "Rapport non disponible"},
            ${JSON.stringify(opportunities)}
          )
          ON CONFLICT (site_id, week_start) DO UPDATE SET
            summary = EXCLUDED.summary,
            recommendations = EXCLUDED.recommendations,
            top_opportunities = EXCLUDED.top_opportunities,
            created_at = NOW()
        `;

        results.push({ site: site.name, status: "ok", clicks: totalClicks });
      } catch (err: unknown) {
        results.push({
          site: site.name,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
    }

    await sendWeeklyReportsEmail(weekStartStr, results);

    return NextResponse.json({ success: true, week: weekStartStr, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
