import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = readFileSync(join(__dirname, '../.env.local'), 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.+?)"?\s*$/);
  if (m) env[m[1]] = m[2].replace(/\\n/g, '\n');
}

const sql = neon(env.DATABASE_URL);
let credentials;
try { credentials = JSON.parse(env.GOOGLE_CREDENTIALS); }
catch { credentials = JSON.parse(readFileSync(join(__dirname, '../../seo-backtest/gsc-service-account.json'), 'utf8')); }

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
const gsc = google.searchconsole({ version: 'v1', auth });

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node backfill-gsc.mjs YYYY-MM-DD [YYYY-MM-DD ...]');
  process.exit(1);
}

const sites = await sql`SELECT * FROM sites WHERE is_active = true AND gsc_property IS NOT NULL`;
console.log(`Backfill ${targets.join(', ')} sur ${sites.length} sites`);

let total = 0;
for (const date of targets) {
  console.log(`\n=== ${date} ===`);
  for (const site of sites) {
    try {
      const res = await gsc.searchanalytics.query({
        siteUrl: site.gsc_property,
        requestBody: { startDate: date, endDate: date, dimensions: ['query', 'page', 'date'], rowLimit: 25000 },
      });
      const rows = res.data.rows || [];
      let inserted = 0;
      for (const row of rows) {
        const [query, page, d] = row.keys;
        const result = await sql`
          INSERT INTO search_console_data (site_id, date, query, page, clicks, impressions, ctr, position)
          VALUES (${site.id}, ${d}, ${query}, ${page}, ${row.clicks||0}, ${row.impressions||0}, ${row.ctr||0}, ${row.position||0})
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        inserted += result.length;
      }
      total += inserted;
      console.log(`  ${site.name.padEnd(30)} ${rows.length} rows / ${inserted} new`);
    } catch (e) {
      console.log(`  ${site.name}: ERR ${e.message}`);
    }
  }
}
console.log(`\nTotal: ${total} lignes backfillées`);
process.exit(0);
