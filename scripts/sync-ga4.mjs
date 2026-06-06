import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env — try .env.production then .env.local (mirrors portfolio-audit pattern)
function loadEnvFile(file) {
  try {
    const raw = readFileSync(join(__dirname, '..', file), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v.replace(/\\n/g, '\n');
    }
  } catch (_e) { /* file may not exist */ }
}
loadEnvFile('.env.production');
loadEnvFile('.env.local');

const sql = neon(process.env.DATABASE_URL);

// Service account
import { existsSync } from 'fs';
let credentials;
const saPaths = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  process.env.GOOGLE_CREDENTIALS ? null : undefined, // handled below
  join(__dirname, '../../Downloads/gsc-service-account.json.json'),
  join(__dirname, '../../Downloads/gsc-service-account.json'),
  join(__dirname, '../../seo-backtest/gsc-service-account.json'),
].filter(Boolean);

if (process.env.GOOGLE_CREDENTIALS) {
  try { credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); } catch (_e) {}
}
if (!credentials) {
  for (const p of saPaths) {
    if (existsSync(p)) { credentials = JSON.parse(readFileSync(p, 'utf8')); console.log(`[auth] ${p}`); break; }
  }
}
if (!credentials) { console.error('No GA4 service account found'); process.exit(1); }

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
});

const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

const endDate = new Date().toISOString().split('T')[0];
const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

async function syncSite(site) {
  // Strip "properties/" prefix if already present to avoid "properties/properties/..." double-prefix
  const propId = String(site.ga_property_id).replace(/^properties\//, '');
  console.log(`\n→ ${site.name} (GA4: ${propId})`);
  if (!propId || propId.startsWith('G-')) {
    console.log(`  SKIP: ga_property_id is a Measurement ID, not a Property ID. Fix in DB.`);
    return 0;
  }
  try {
    const res = await analyticsData.properties.runReport({
      property: `properties/${propId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
        ],
        limit: 100000,
      },
    });

    const rows = res.data.rows || [];
    console.log(`  ${rows.length} lignes GA4`);

    // Aggregate by date
    const byDate = {};
    for (const row of rows) {
      const dateRaw = row.dimensionValues[0].value;
      const channel = row.dimensionValues[1].value.toLowerCase();
      const date = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;
      const sessions = parseInt(row.metricValues[0].value || '0');

      if (!byDate[date]) byDate[date] = { sessions:0, users:0, new_users:0, pageviews:0, bounce:0, duration:0, organic:0, direct:0, referral:0, social:0, count:0 };
      const d = byDate[date];
      d.sessions += sessions;
      d.users += parseInt(row.metricValues[1].value || '0');
      d.new_users += parseInt(row.metricValues[2].value || '0');
      d.pageviews += parseInt(row.metricValues[3].value || '0');
      d.bounce += parseFloat(row.metricValues[4].value || '0');
      d.duration += parseFloat(row.metricValues[5].value || '0');
      d.count++;
      if (channel.includes('organic')) d.organic += sessions;
      else if (channel.includes('direct')) d.direct += sessions;
      else if (channel.includes('referral')) d.referral += sessions;
      else if (channel.includes('social')) d.social += sessions;
    }

    let inserted = 0;
    for (const [date, d] of Object.entries(byDate)) {
      await sql`
        INSERT INTO analytics_daily
          (site_id, date, sessions, users, new_users, pageviews, bounce_rate, avg_session_duration,
           organic_sessions, direct_sessions, referral_sessions, social_sessions)
        VALUES (
          ${site.id}, ${date}, ${d.sessions}, ${d.users}, ${d.new_users}, ${d.pageviews},
          ${d.count > 0 ? d.bounce / d.count : 0},
          ${d.count > 0 ? d.duration / d.count : 0},
          ${d.organic}, ${d.direct}, ${d.referral}, ${d.social}
        )
        ON CONFLICT (site_id, date) DO UPDATE SET
          sessions = EXCLUDED.sessions, users = EXCLUDED.users,
          pageviews = EXCLUDED.pageviews, organic_sessions = EXCLUDED.organic_sessions,
          direct_sessions = EXCLUDED.direct_sessions
      `;
      inserted++;
    }
    console.log(`  ${inserted} jours insérés`);
    return inserted;
  } catch (e) {
    console.log(`  ERR: ${e.message}`);
    return 0;
  }
}

const sites = await sql`SELECT * FROM sites WHERE is_active = true AND ga_property_id IS NOT NULL`;
console.log(`${sites.length} sites GA4 à synchroniser (${startDate} → ${endDate})`);

let total = 0;
for (const site of sites) total += await syncSite(site);
console.log(`\nTotal: ${total} jours GA4 insérés`);
process.exit(0);
