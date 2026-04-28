import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT MAX(date) AS max_date, MIN(date) AS min_date, COUNT(*) AS total FROM search_console_data`;
console.log("freshness:", r[0]);
const today = new Date(); today.setUTCHours(0,0,0,0);
const max = new Date(r[0].max_date);
const lag = Math.round((today - max) / 86400000);
console.log(`lag_days=${lag}`);
