import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envFile = readFileSync(join(__dirname, '../.env.local'), 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.+?)"?\s*$/);
  if (m) env[m[1]] = m[2].replace(/\\n/g, '\n');
}

const sql = neon(env.DATABASE_URL);

// Service account from env or file
let credentials;
try {
  credentials = JSON.parse(env.GOOGLE_CREDENTIALS);
} catch {
  credentials = JSON.parse(readFileSync(join(__dirname, '../../seo-backtest/gsc-service-account.json'), 'utf8'));
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
});
const gsc = google.searchconsole({ version: 'v1', auth });

const PAGE_SIZE = 25000;
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function fetchAll(siteUrl, requestBody) {
  const rows = [];
  for (let startRow = 0; ; startRow += PAGE_SIZE) {
    const res = await gsc.searchanalytics.query({
      siteUrl,
      requestBody: { ...requestBody, rowLimit: PAGE_SIZE, startRow },
    });
    const pageRows = res.data.rows || [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

const endDate = daysAgo(2);
// 45j pour couvrir W4 (29-35j) du tableau Gains/semaine
const startDate = daysAgo(45);

async function syncSite(site) {
  console.log(`\n→ ${site.name} (${site.gsc_property})`);
  try {
    const rows = await fetchAll(site.gsc_property, {
        startDate,
        endDate,
        dimensions: ['query', 'page', 'date'],
        dataState: 'final',
    });

    console.log(`  ${rows.length} rows`);
    let inserted = 0;

    for (const row of rows) {
      const [query, page, date] = row.keys;
      await sql`
        INSERT INTO search_console_data (site_id, date, query, page, clicks, impressions, ctr, position)
        VALUES (${site.id}, ${date}, ${query}, ${page}, ${row.clicks||0}, ${row.impressions||0}, ${row.ctr||0}, ${row.position||0})
        ON CONFLICT DO NOTHING
      `;
      inserted++;
    }

    const queryRows = await fetchAll(site.gsc_property, {
      startDate,
      endDate,
      dimensions: ['query', 'country', 'date'],
      dataState: 'final',
    });
    console.log(`  ${queryRows.length} query-level rows`);
    for (const row of queryRows) {
      const [query, country, date] = row.keys;
      if ((row.position || 0) > 200) continue;
      await sql`
        INSERT INTO search_console_query_data
        (site_id, date, query, country, device, clicks, impressions, ctr, position)
        VALUES (${site.id}, ${date}, ${query || ''}, ${(country || '').toUpperCase()}, '',
                ${row.clicks || 0}, ${row.impressions || 0}, ${row.ctr || 0}, ${row.position || 0})
        ON CONFLICT (site_id, date, query, country, device)
        DO UPDATE SET
          clicks = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          ctr = EXCLUDED.ctr,
          position = EXCLUDED.position,
          synced_at = NOW()
      `;
      inserted++;
    }
    console.log(`  ${inserted} inseres`);
    return inserted;
  } catch (e) {
    console.log(`  ERR: ${e.message}`);
    return 0;
  }
}

await sql`
  CREATE TABLE IF NOT EXISTS search_console_query_data (
    id BIGSERIAL PRIMARY KEY,
    site_id INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '',
    clicks INT NOT NULL DEFAULT 0,
    impressions INT NOT NULL DEFAULT 0,
    ctr REAL NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_scqd_natural_key
  ON search_console_query_data (site_id, date, query, country, device)
`;

const sites = await sql`SELECT * FROM sites WHERE is_active = true AND gsc_property IS NOT NULL`;
console.log(`${sites.length} sites a synchroniser (${startDate} → ${endDate})`);

let total = 0;
for (const site of sites) {
  total += await syncSite(site);
}

console.log(`\nTotal: ${total} lignes GSC inserees`);
process.exit(0);
