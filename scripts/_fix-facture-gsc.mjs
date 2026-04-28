import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);
const before = await sql`SELECT id,name,gsc_property FROM sites WHERE id=27`;
console.log("AVANT:", before[0]);
const r = await sql`UPDATE sites SET gsc_property='https://xn--factureimpaye-mhb.fr/' WHERE id=27 RETURNING id,name,gsc_property`;
console.log("APRES:", r[0]);
