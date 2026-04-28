#!/usr/bin/env node
// GSC indexation analyzer vocalis.pro
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const ENV_PATH = path.resolve(process.cwd(), '.env.local');
const OUT_DIR = 'C:/tmp/gsc-fix';

function loadEnv(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const m = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    m[k] = v;
  }
  return m;
}
function parseCreds(raw) {
  let s = raw.trim();
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(Buffer.from(s, 'base64').toString('utf8')); } catch {}
  if (fs.existsSync(s)) return JSON.parse(fs.readFileSync(s, 'utf8'));
  throw new Error('bad creds');
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const env = loadEnv(ENV_PATH);
  const creds = parseCreds(env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/webmasters'],
  });
  await auth.authorize();
  const sc = google.searchconsole({ version: 'v1', auth });
  const siteUrl = 'sc-domain:vocalis.pro';

  // Parse sitemap
  const sm = fs.readFileSync('C:/Users/cohen.000/vocalis-clone/output/sitemap.xml', 'utf8');
  const sitemapUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  console.log(`Sitemap URLs: ${sitemapUrls.length}`);

  // Search Analytics - last 90 days
  const end = new Date().toISOString().slice(0, 10);
  const startD = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  let analyticsUrls = new Set();
  try {
    const r = await sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: startD, endDate: end, dimensions: ['page'], rowLimit: 5000 },
    });
    (r.data.rows || []).forEach(row => analyticsUrls.add(row.keys[0]));
    console.log(`Search Analytics distinct pages (90d): ${analyticsUrls.size}`);
  } catch (e) {
    console.log(`Search analytics fail: ${e.message}`);
  }

  const allUrls = new Set([...sitemapUrls, ...analyticsUrls]);
  console.log(`Total union URLs to inspect: ${allUrls.size}`);
  fs.writeFileSync(path.join(OUT_DIR, 'all-urls.json'), JSON.stringify([...allUrls], null, 2));

  const results = {};
  const urls = [...allUrls];
  console.log(`Inspecting ${urls.length} URLs...`);
  let done = 0;
  for (const u of urls) {
    try {
      const r = await sc.urlInspection.index.inspect({
        requestBody: { inspectionUrl: u, siteUrl, languageCode: 'fr-FR' },
      });
      const idx = r.data?.inspectionResult?.indexStatusResult || {};
      results[u] = {
        verdict: idx.verdict,
        coverageState: idx.coverageState,
        robotsTxtState: idx.robotsTxtState,
        indexingState: idx.indexingState,
        pageFetchState: idx.pageFetchState,
        lastCrawlTime: idx.lastCrawlTime,
        googleCanonical: idx.googleCanonical,
        userCanonical: idx.userCanonical,
        crawledAs: idx.crawledAs,
      };
    } catch (e) {
      const code = e?.code || e?.response?.status;
      results[u] = { error: e?.errors?.[0]?.message || e?.message, code };
      if (code === 429) {
        console.log('  429 rate limit, sleeping 30s...');
        await new Promise(r => setTimeout(r, 30000));
      }
    }
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${urls.length}`);
    if (done % 25 === 0) fs.writeFileSync(path.join(OUT_DIR, 'inspection.json'), JSON.stringify(results, null, 2));
    await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'inspection.json'), JSON.stringify(results, null, 2));

  const buckets = {};
  for (const [u, d] of Object.entries(results)) {
    const k = d.coverageState || (d.error ? `ERROR:${d.code}` : 'UNKNOWN');
    (buckets[k] ||= []).push(u);
  }
  console.log('\n=== COVERAGE BUCKETS ===');
  for (const [k, arr] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${arr.length.toString().padStart(4)}  ${k}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'buckets.json'), JSON.stringify(buckets, null, 2));
  console.log('\nFiles: all-urls.json, inspection.json, buckets.json in', OUT_DIR);
}
main().catch(e => { console.error(e); process.exit(1); });
