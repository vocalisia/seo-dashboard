import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
function loadEnv(p){if(!existsSync(p))return;for(const l of readFileSync(p,"utf-8").split(/\r?\n/)){const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^"|"$/g,"");}}
loadEnv("C:/Users/cohen.000/seo-dashboard/.env.local");loadEnv("C:/Users/cohen.000/seo-dashboard/.env.production");
const sql=neon(process.env.DATABASE_URL);

// pick first site id
const [{id:siteId}]=await sql`SELECT id FROM sites WHERE is_active=true ORDER BY id LIMIT 1`;
console.log("test siteId",siteId);

// 1st insert
const a=await sql`
  INSERT INTO search_console_data
  (site_id, date, query, page, clicks, impressions, ctr, position, country, device)
  VALUES (${siteId},'2026-01-01','__test__','/__test__',1,10,0.1,5.0,'','')
  ON CONFLICT (site_id, date, (COALESCE(query,'')), (COALESCE(page,'')), (COALESCE(country,'')), (COALESCE(device,'')))
  DO UPDATE SET clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions
  RETURNING id, clicks, impressions
`;
console.log("first insert:",a);

// 2nd insert same key, different values → should UPDATE
const b=await sql`
  INSERT INTO search_console_data
  (site_id, date, query, page, clicks, impressions, ctr, position, country, device)
  VALUES (${siteId},'2026-01-01','__test__','/__test__',2,20,0.2,3.0,'','')
  ON CONFLICT (site_id, date, (COALESCE(query,'')), (COALESCE(page,'')), (COALESCE(country,'')), (COALESCE(device,'')))
  DO UPDATE SET clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions
  RETURNING id, clicks, impressions
`;
console.log("second upsert:",b);

// count rows for test key
const c=await sql`SELECT COUNT(*)::int AS n FROM search_console_data WHERE site_id=${siteId} AND query='__test__'`;
console.log("rows for test key:",c[0].n,"(must be 1)");

// cleanup
await sql`DELETE FROM search_console_data WHERE site_id=${siteId} AND query='__test__'`;
console.log("cleaned");
