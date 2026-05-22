import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
function loadEnv(p){if(!existsSync(p))return;for(const l of readFileSync(p,"utf-8").split(/\r?\n/)){const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^"|"$/g,"");}}
loadEnv("C:/Users/cohen.000/seo-dashboard/.env.local");loadEnv("C:/Users/cohen.000/seo-dashboard/.env.production");
const sql = neon(process.env.DATABASE_URL);
const GSC_LAG_DAYS = 3;

// Simulate /api/sites?days=3 (unfiltered, what the homepage shows for "3 derniers jours")
const days = 3;
const rows = await sql`
  SELECT
    s.name,
    COALESCE(gsc.total_clicks, 0)       AS clicks,
    COALESCE(gsc.total_impressions, 0)  AS impressions,
    COALESCE(gsc.avg_position, 0)       AS position
  FROM sites s
  LEFT JOIN (
    SELECT site_id,
      SUM(clicks)::int as total_clicks,
      SUM(impressions)::int as total_impressions,
      ROUND(AVG(NULLIF(position, 0))::numeric, 1) as avg_position
    FROM search_console_data
    WHERE date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
      AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
      AND (country IS NULL OR country = '')
    GROUP BY site_id
  ) gsc ON gsc.site_id = s.id
  WHERE s.is_active = true
  ORDER BY clicks DESC
`;
console.log(`[sim] /api/sites?days=3 (post-fix) — what dashboard 3d card will show:`);
for (const r of rows) console.log(`  ${r.name.padEnd(20)} clk=${String(r.clicks).padStart(4)} imp=${String(r.impressions).padStart(5)} pos=${String(r.position).padStart(5)}`);

const tot = rows.reduce((a,r)=>({c:a.c+Number(r.clicks),i:a.i+Number(r.impressions)}),{c:0,i:0});
console.log(`\n[sim] portfolio TOTAL 3d: clicks=${tot.c} impressions=${tot.i}`);
console.log(`[sim] live GSC TOTAL 3d (6 sites from final_report): clicks=13 impressions=1507`);
console.log(`[sim] full portfolio live not in final_report — 6-site subset is representative`);
