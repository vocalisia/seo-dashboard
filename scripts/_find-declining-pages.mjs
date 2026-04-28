import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);

// KW business strategiques chutes (extraits des alertes)
const targets = [
  { kw: "chatbot vocal ia", site_id: 10 },
  { kw: "vocal ai", site_id: 10 },
  { kw: "chatbot vocal", site_id: 10 },
  { kw: "www.vocalis.pro", site_id: 10 },
  { kw: "trustvault", site_id: 16 },
  { kw: "agence ia pour pme", site_id: 12 },
  { kw: "formation ia pme suisse", site_id: 12 },
];

console.log("KW -> meilleure URL ranke (impressions max sur 30j):\n");
for (const t of targets) {
  const r = await sql`
    SELECT page,
           SUM(impressions)::int AS impressions,
           SUM(clicks)::int AS clicks,
           AVG(position)::numeric(6,2) AS avg_pos
    FROM search_console_data
    WHERE site_id = ${t.site_id}
      AND query = ${t.kw}
      AND date >= NOW() - INTERVAL '30 days'
      AND page IS NOT NULL
    GROUP BY page
    ORDER BY impressions DESC
    LIMIT 1
  `;
  if (r.length === 0) {
    console.log(`  [${t.kw}] (site=${t.site_id}) -> AUCUNE PAGE TROUVEE`);
  } else {
    console.log(`  [${t.kw}] (site=${t.site_id}) -> ${r[0].page} (impr=${r[0].impressions} clicks=${r[0].clicks} pos=${r[0].avg_pos})`);
  }
}
