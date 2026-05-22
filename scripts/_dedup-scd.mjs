// scripts/_dedup-scd.mjs
// FIX 1 — Deduplicate search_console_data + install UNIQUE constraint
// Safe: keeps latest row per natural key, no TRUNCATE/DROP.
// Usage: node scripts/_dedup-scd.mjs

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";

function loadEnv(path) {
  if (!existsSync(path)) return;
  const env = readFileSync(path, "utf-8");
  for (const l of env.split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnv("C:/Users/cohen.000/seo-dashboard/.env.local");
loadEnv("C:/Users/cohen.000/seo-dashboard/.env.production");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

console.log("[scd-dedup] starting");

// 1. baseline counts
const before = await sql`SELECT COUNT(*)::int AS c FROM search_console_data`;
console.log(`[scd-dedup] before: ${before[0].c.toLocaleString()} rows`);

// natural key = site_id, date, query, page, country, device (NULLs treated as '')
const dupGroups = await sql`
  WITH g AS (
    SELECT site_id, date,
           COALESCE(query,'')   AS query,
           COALESCE(page,'')    AS page,
           COALESCE(country,'') AS country,
           COALESCE(device,'')  AS device,
           COUNT(*) AS n
    FROM search_console_data
    GROUP BY 1,2,3,4,5,6
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*)::int AS dup_groups, SUM(n - 1)::int AS extra_rows FROM g
`;
console.log(`[scd-dedup] duplicate groups: ${dupGroups[0].dup_groups?.toLocaleString() ?? 0}`);
console.log(`[scd-dedup] extra rows to delete: ${dupGroups[0].extra_rows?.toLocaleString() ?? 0}`);

// 2. dedup — keep MAX(id) per natural key (latest insert wins)
// Done in batches to avoid Neon statement timeout on large tables.
const BATCH = 50000;
let totalDeleted = 0;
let pass = 0;
while (true) {
  pass++;
  const res = await sql`
    WITH dups AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY site_id, date,
                            COALESCE(query,''),
                            COALESCE(page,''),
                            COALESCE(country,''),
                            COALESCE(device,'')
               ORDER BY id DESC
             ) AS rn
      FROM search_console_data
    ),
    target AS (
      SELECT id FROM dups WHERE rn > 1 LIMIT ${BATCH}
    )
    DELETE FROM search_console_data
    WHERE id IN (SELECT id FROM target)
    RETURNING id
  `;
  totalDeleted += res.length;
  console.log(`[scd-dedup] pass ${pass}: deleted ${res.length} rows (cumulative ${totalDeleted.toLocaleString()})`);
  if (res.length < BATCH) break;
  if (pass > 200) {
    console.error("[scd-dedup] safety stop after 200 passes");
    break;
  }
}

const after = await sql`SELECT COUNT(*)::int AS c FROM search_console_data`;
console.log(`[scd-dedup] after: ${after[0].c.toLocaleString()} rows`);
console.log(`[scd-dedup] removed: ${(before[0].c - after[0].c).toLocaleString()} rows (${(((before[0].c - after[0].c) / before[0].c) * 100).toFixed(1)}%)`);

// 3. install UNIQUE index (partial index using COALESCE so NULL country/device
//    collapses with empty-string variants — matches the dedup partition key).
// Use a UNIQUE INDEX (expressions) rather than table constraint so we can use COALESCE.
console.log("[scd-dedup] installing UNIQUE index uq_scd_natural_key");
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_scd_natural_key
  ON search_console_data (
    site_id,
    date,
    COALESCE(query,''),
    COALESCE(page,''),
    COALESCE(country,''),
    COALESCE(device,'')
  )
`;
console.log("[scd-dedup] index installed");

// 4. verification — re-run group query, should be 0
const verify = await sql`
  WITH g AS (
    SELECT site_id, date,
           COALESCE(query,'')   AS query,
           COALESCE(page,'')    AS page,
           COALESCE(country,'') AS country,
           COALESCE(device,'')  AS device,
           COUNT(*) AS n
    FROM search_console_data
    GROUP BY 1,2,3,4,5,6
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*)::int AS dup_groups FROM g
`;
console.log(`[scd-dedup] post-fix duplicate groups: ${verify[0].dup_groups} (must be 0)`);

if (verify[0].dup_groups !== 0) {
  console.error("[scd-dedup] FAILED — duplicates remain");
  process.exit(2);
}
console.log("[scd-dedup] done.");
