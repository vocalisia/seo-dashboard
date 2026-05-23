/**
 * migrate-query-level-table.mjs
 *
 * Creates search_console_query_data — the query-level (no page split) GSC table
 * that returns Google's REAL displayed position for a query, matching what users
 * see in the GSC UI. Page-level search_console_data over-aggregates positions
 * across pages with very different ranks, producing nonsense weighted averages.
 *
 * Schema mirrors search_console_data but WITHOUT the `page` column.
 * Natural key: (site_id, date, query, country, device) → ON CONFLICT upsert.
 */

import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnv(file) {
  try {
    const raw = readFileSync(join(ROOT, file), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+?)\s*$/);
      if (m) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!process.env[m[1]]) process.env[m[1]] = v.replace(/\\n/g, '\n');
      }
    }
  } catch (_e) { /* ok */ }
}
loadEnv('.env.production');
loadEnv('.env.local');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

console.log('[migrate] creating search_console_query_data ...');

await sql`
  CREATE TABLE IF NOT EXISTS search_console_query_data (
    id           BIGSERIAL PRIMARY KEY,
    site_id      INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    date         DATE NOT NULL,
    query        TEXT NOT NULL DEFAULT '',
    country      TEXT NOT NULL DEFAULT '',
    device       TEXT NOT NULL DEFAULT '',
    clicks       INT NOT NULL DEFAULT 0,
    impressions  INT NOT NULL DEFAULT 0,
    ctr          REAL NOT NULL DEFAULT 0,
    position     REAL NOT NULL DEFAULT 0,
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_scqd_natural_key
  ON search_console_query_data (site_id, date, query, country, device)
`;

await sql`
  CREATE INDEX IF NOT EXISTS idx_scqd_site_query_country
  ON search_console_query_data (site_id, query, country)
`;

await sql`
  CREATE INDEX IF NOT EXISTS idx_scqd_site_date
  ON search_console_query_data (site_id, date)
`;

console.log('[migrate] table + indexes ready');

const r = await sql`SELECT COUNT(*) AS n FROM search_console_query_data`;
console.log(`[migrate] current row count: ${r[0].n}`);
