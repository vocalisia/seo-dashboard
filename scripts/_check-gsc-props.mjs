import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT id, name, url, gsc_property, ga_property_id FROM sites WHERE name IN ('Vocalis Blog','Trust Crypto','Facture Impayée') OR name LIKE '%Facture%' ORDER BY id`;
for (const r of rows) console.log(r);
