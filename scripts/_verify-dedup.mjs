import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);
const today = await sql`SELECT COUNT(*) AS c FROM seo_alerts WHERE created_at::date = CURRENT_DATE`;
const total = await sql`SELECT COUNT(*) AS c FROM seo_alerts`;
const dups = await sql`
  SELECT site_id, alert_type, keyword, created_at::date AS day, COUNT(*) AS n
  FROM seo_alerts
  GROUP BY site_id, alert_type, keyword, created_at::date
  HAVING COUNT(*) > 1
`;
console.log(`total alertes: ${total[0].c}`);
console.log(`alertes today: ${today[0].c}`);
console.log(`doublons restants: ${dups.length}`);
