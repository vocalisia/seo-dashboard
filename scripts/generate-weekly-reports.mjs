import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env.local"));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL missing");
}

const sql = neon(process.env.DATABASE_URL);

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const match = line.match(/^([\w.-]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^"/, "").replace(/"$/, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function buildFallbackReport(weekStart, data) {
  const gainText = data.gains
    .slice(0, 3)
    .map((g) => `${g.query} (+${g.gain.toFixed(1)} -> pos ${g.position_now.toFixed(1)})`)
    .join(", ");
  const lossText = data.losses
    .slice(0, 3)
    .map((g) => `${g.query} (${g.gain.toFixed(1)} -> pos ${g.position_now.toFixed(1)})`)
    .join(", ");
  const oppText = data.opportunities
    .slice(0, 3)
    .map((o) => `${o.query} (pos ${o.position.toFixed(1)}, ${o.impressions} impr.)`)
    .join(", ");

  return [
    `Resume semaine du ${weekStart}: ${data.totalClicks} clics, ${data.totalImpressions} impressions, position moyenne ${data.avgPosition.toFixed(1)}.`,
    gainText ? `Progressions: ${gainText}.` : "Progressions: aucune hausse significative detectee.",
    lossText ? `Replis: ${lossText}.` : "Replis: aucune baisse significative detectee.",
    oppText ? `Priorites: travailler ${oppText}.` : "Priorites: consolider les pages deja visibles et renforcer le maillage interne.",
  ].join("\n\n");
}

async function ensureWeeklyReportsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      week_start DATE NOT NULL,
      summary TEXT,
      recommendations TEXT,
      top_opportunities JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(site_id, week_start)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_reports_site ON weekly_reports(site_id, week_start DESC)`;
}

async function sendWeeklyReportsEmail(weekStart, results) {
  const resendKey = process.env.RESEND_API_KEY?.replace(/\\n/g, "").trim();
  const alertEmail = process.env.ALERT_EMAIL?.replace(/\\n/g, "").trim();
  const fromEmail = process.env.REPORTS_FROM_EMAIL?.replace(/\\n/g, "").trim() || "contact@job-emploi.ch";
  if (!resendKey || !alertEmail) return { skipped: true };

  const ok = results.filter((r) => r.status === "ok");
  const noData = results.filter((r) => r.status === "no_data");
  const failed = results.filter((r) => r.status === "error");
  const totalClicks = ok.reduce((sum, r) => sum + Number(r.clicks ?? 0), 0);

  const html = `
<h2>Rapport SEO hebdomadaire</h2>
<p>Semaine du ${weekStart} - ${ok.length} site(s) analyses, ${totalClicks} clics cumules.</p>
${ok.length ? `<h3>Sites analyses (${ok.length})</h3><ul>${ok.map((r) => `<li><strong>${r.site}</strong> - ${Number(r.clicks ?? 0)} clics</li>`).join("")}</ul>` : ""}
${noData.length ? `<h3>Sans donnees (${noData.length})</h3><ul>${noData.map((r) => `<li><strong>${r.site}</strong></li>`).join("")}</ul>` : ""}
${failed.length ? `<h3>Echecs (${failed.length})</h3><ul>${failed.map((r) => `<li><strong>${r.site}</strong> - ${r.error ?? "Erreur inconnue"}</li>`).join("")}</ul>` : ""}
<p style="color:#888;font-size:12px">SEO Dashboard - ${new Date().toLocaleString("fr-FR")}</p>
  `.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
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
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    if (!res.ok) {
      return { skipped: false, ok: false, error: `Resend ${res.status}: ${text}` };
    }
    return { skipped: false, ok: true, response: text };
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  await ensureWeeklyReportsTable();

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const sites = await sql`SELECT id, name, url FROM sites WHERE is_active = true ORDER BY id`;
  const results = [];

  for (const site of sites) {
    try {
      const topQueries = await sql`
        SELECT query,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          AVG(position) as position
        FROM search_console_data
        WHERE site_id = ${site.id}
          AND date >= NOW() - INTERVAL '7 days'
          AND query IS NOT NULL
        GROUP BY query
        ORDER BY SUM(clicks) DESC
        LIMIT 50
      `;

      if (!topQueries.length) {
        results.push({ site: site.name, status: "no_data" });
        continue;
      }

      const gainRows = await sql`
        WITH cur AS (
          SELECT query, AVG(position) as pos_now
          FROM search_console_data
          WHERE site_id = ${site.id}
            AND date >= NOW() - INTERVAL '7 days'
            AND query IS NOT NULL
          GROUP BY query
        ),
        prev AS (
          SELECT query, AVG(position) as pos_prev
          FROM search_console_data
          WHERE site_id = ${site.id}
            AND date >= NOW() - INTERVAL '14 days'
            AND date < NOW() - INTERVAL '7 days'
            AND query IS NOT NULL
          GROUP BY query
        )
        SELECT c.query,
          ROUND((p.pos_prev - c.pos_now)::numeric, 1) as gain,
          ROUND(c.pos_now::numeric, 1) as position_now
        FROM cur c
        JOIN prev p ON p.query = c.query
        WHERE ABS(p.pos_prev - c.pos_now) > 0.5
        ORDER BY gain DESC
        LIMIT 20
      `;

      const gains = gainRows.filter((g) => Number(g.gain) > 0).map((g) => ({
        query: String(g.query),
        gain: Number(g.gain),
        position_now: Number(g.position_now),
      }));
      const losses = gainRows.filter((g) => Number(g.gain) < 0).map((g) => ({
        query: String(g.query),
        gain: Number(g.gain),
        position_now: Number(g.position_now),
      }));

      const totalClicks = topQueries.reduce((sum, row) => sum + Number(row.clicks), 0);
      const totalImpressions = topQueries.reduce((sum, row) => sum + Number(row.impressions), 0);
      const avgPosition = topQueries.reduce((sum, row) => sum + Number(row.position), 0) / topQueries.length;
      const opportunities = topQueries
        .filter((row) => Number(row.position) >= 11 && Number(row.position) <= 20)
        .slice(0, 5)
        .map((row) => ({
          query: String(row.query),
          impressions: Number(row.impressions),
          position: Number(row.position),
        }));

      const report = buildFallbackReport(weekStartStr, {
        gains,
        losses,
        opportunities,
        totalClicks,
        totalImpressions,
        avgPosition,
      });

      await sql`
        INSERT INTO weekly_reports (site_id, week_start, summary, recommendations, top_opportunities)
        VALUES (
          ${site.id},
          ${weekStartStr},
          ${`Semaine du ${weekStartStr} - ${totalClicks} clics, ${totalImpressions} impressions, position moy. ${avgPosition.toFixed(1)}`},
          ${report},
          ${JSON.stringify(opportunities)}
        )
        ON CONFLICT (site_id, week_start) DO UPDATE SET
          summary = EXCLUDED.summary,
          recommendations = EXCLUDED.recommendations,
          top_opportunities = EXCLUDED.top_opportunities,
          created_at = NOW()
      `;

      results.push({ site: site.name, status: "ok", clicks: totalClicks });
    } catch (error) {
      results.push({
        site: site.name,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const email = await sendWeeklyReportsEmail(weekStartStr, results);
  console.log(JSON.stringify({ success: true, week: weekStartStr, results, email }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
