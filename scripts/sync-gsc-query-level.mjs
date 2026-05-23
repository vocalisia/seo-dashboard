/**
 * sync-gsc-query-level.mjs
 *
 * Populates search_console_query_data with query-level (no page dim) GSC data
 * for the last 45d. Run after creating the table to backfill before deploy.
 *
 * dimensions=['query','country','date'] → returns Google's REAL displayed
 * position per query (matches GSC UI), not the page-weighted nonsense.
 */

import { readFileSync, existsSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';
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
  console.error('DATABASE_URL missing'); process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// Service account credentials
let credentials;
const saPaths = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  join(ROOT, '..', 'seo-backtest', 'gsc-service-account.json'),
  join(ROOT, '..', 'Downloads', 'gsc-service-account.json.json'),
  join(ROOT, '..', 'Downloads', 'gsc-service-account.json'),
].filter(Boolean);

if (process.env.GOOGLE_CREDENTIALS) {
  try { credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); } catch (_e) {}
}
if (!credentials) {
  for (const p of saPaths) {
    if (existsSync(p)) {
      credentials = JSON.parse(readFileSync(p, 'utf8'));
      console.log(`[auth] using service account: ${p}`);
      break;
    }
  }
}
if (!credentials) {
  console.error('No GSC service account credentials found.'); process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
});
const gsc = google.searchconsole({ version: 'v1', auth });

const endDate   = new Date().toISOString().split('T')[0];
const startDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

async function syncSiteQueryLevel(site) {
  console.log(`\n→ ${site.name} (${site.gsc_property})`);
  try {
    const res = await gsc.searchanalytics.query({
      siteUrl: site.gsc_property,
      requestBody: {
        startDate, endDate,
        dimensions: ['query', 'country', 'date'],
        dataState: 'final',
        rowLimit: 25000, startRow: 0,
      },
    });
    const rows = res.data.rows || [];
    console.log(`  ${rows.length} query-level rows`);
    let inserted = 0;
    for (const row of rows) {
      if ((row.position || 0) > 200) continue;
      const [query, country, date] = row.keys;
      await sql`
        INSERT INTO search_console_query_data
        (site_id, date, query, country, device, clicks, impressions, ctr, position)
        VALUES (${site.id}, ${date}, ${query || ''}, ${(country || '').toUpperCase()}, '',
                ${row.clicks || 0}, ${row.impressions || 0}, ${row.ctr || 0}, ${row.position || 0})
        ON CONFLICT (site_id, date, query, country, device)
        DO UPDATE SET
          clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions,
          ctr=EXCLUDED.ctr, position=EXCLUDED.position, synced_at=NOW()
      `;
      inserted++;
    }
    console.log(`  ${inserted} upserted`);
    return inserted;
  } catch (e) {
    console.log(`  ERR: ${e.message}`);
    return 0;
  }
}

const sites = await sql`SELECT id, name, gsc_property FROM sites WHERE is_active = true AND gsc_property IS NOT NULL ORDER BY id`;
console.log(`${sites.length} sites — ${startDate} → ${endDate}`);

let total = 0;
for (const site of sites) {
  total += await syncSiteQueryLevel(site);
}
console.log(`\nTOTAL: ${total} query-level rows upserted`);
