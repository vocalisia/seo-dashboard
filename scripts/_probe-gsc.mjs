import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);
console.log("--- counts by site, last 30d ---");
const rows = await sql`
  SELECT s.id, s.name,
    COUNT(*) AS rows30,
    COUNT(DISTINCT g.query) AS unique_queries,
    SUM(g.clicks)::int AS total_clicks
  FROM sites s
  LEFT JOIN search_console_data g
    ON g.site_id = s.id AND g.date >= NOW() - INTERVAL '30 days'
  GROUP BY s.id, s.name
  ORDER BY s.id
`;
for (const r of rows) console.log(`site=${r.id} ${r.name} rows=${r.rows30} queries=${r.unique_queries} clicks=${r.total_clicks}`);
console.log("\n--- max date in table ---");
const max = await sql`SELECT MAX(date) AS max_date, MIN(date) AS min_date, COUNT(*) AS total FROM search_console_data`;
console.log(max[0]);
