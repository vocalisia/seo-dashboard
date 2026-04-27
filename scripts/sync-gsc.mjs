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

const endDate = new Date().toISOString().split('T')[0];
// 45j pour couvrir W4 (29-35j) du tableau Gains/semaine
const startDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

async function syncSite(site) {
  console.log(`\n→ ${site.name} (${site.gsc_property})`);
  try {
    const res = await gsc.searchanalytics.query({
      siteUrl: site.gsc_property,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query', 'page', 'date'],
        rowLimit: 25000,
      },
    });

    const rows = res.data.rows || [];
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
    console.log(`  ${inserted} inseres`);
    return inserted;
  } catch (e) {
    console.log(`  ERR: ${e.message}`);
    return 0;
  }
}

const sites = await sql`SELECT * FROM sites WHERE is_active = true AND gsc_property IS NOT NULL`;
console.log(`${sites.length} sites a synchroniser (${startDate} → ${endDate})`);

let total = 0;
for (const site of sites) {
  total += await syncSite(site);
}

console.log(`\nTotal: ${total} lignes GSC inserees`);
process.exit(0);
