import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
function loadEnv(p){if(!existsSync(p))return;for(const l of readFileSync(p,"utf-8").split(/\r?\n/)){const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^"|"$/g,"");}}
loadEnv("C:/Users/cohen.000/seo-dashboard/.env.local");loadEnv("C:/Users/cohen.000/seo-dashboard/.env.production");
const sql = neon(process.env.DATABASE_URL);

const r = await sql`
  SELECT date::text, country,
         COUNT(*)::int AS rows,
         SUM(clicks)::int AS clk,
         SUM(impressions)::int AS imp
  FROM search_console_data d
  JOIN sites s ON s.id = d.site_id
  WHERE s.name='Vocalis Pro'
    AND date >= '2026-05-17' AND date <= '2026-05-19'
  GROUP BY date, country
  ORDER BY date, country NULLS FIRST
`;
console.log("Vocalis Pro 2026-05-17..05-19 (per-date, per-country):");
for (const x of r) console.log(`  ${x.date} country=${(x.country||"<NULL>").padEnd(8)} rows=${String(x.rows).padStart(4)} clk=${String(x.clk).padStart(4)} imp=${String(x.imp).padStart(6)}`);

// totals by country tag
const tot = await sql`
  SELECT
    CASE WHEN country IS NULL OR country = '' THEN 'aggregate' ELSE 'country-split' END AS bucket,
    SUM(clicks)::int AS clk, SUM(impressions)::int AS imp
  FROM search_console_data d
  JOIN sites s ON s.id = d.site_id
  WHERE s.name='Vocalis Pro'
    AND date >= '2026-05-17' AND date <= '2026-05-19'
  GROUP BY bucket
`;
console.log("\nVocalis Pro bucket totals:");
for (const x of tot) console.log(`  ${x.bucket.padEnd(15)} clk=${x.clk} imp=${x.imp}`);
