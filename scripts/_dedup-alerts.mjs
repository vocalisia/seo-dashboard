import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);

const before = await sql`SELECT COUNT(*) AS c FROM seo_alerts`;
console.log(`avant: ${before[0].c} alertes en DB`);

// Garde la ligne la plus recente par (site, type, keyword, jour calendaire)
const dropped = await sql`
  DELETE FROM seo_alerts
  WHERE id NOT IN (
    SELECT DISTINCT ON (site_id, alert_type, keyword, created_at::date) id
    FROM seo_alerts
    ORDER BY site_id, alert_type, keyword, created_at::date, created_at DESC
  )
  RETURNING id
`;
console.log(`deleted: ${dropped.length} doublons`);

const after = await sql`SELECT COUNT(*) AS c FROM seo_alerts`;
console.log(`apres: ${after[0].c} alertes uniques`);
