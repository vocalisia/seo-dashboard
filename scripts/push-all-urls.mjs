#!/usr/bin/env node
// Push all vocalis.pro URLs to Google Indexing API + re-submit sitemap
// - Reads GOOGLE_CREDENTIALS from .env.local
// - Fetches sitemap https://vocalis.pro/sitemap.xml (+ nested sitemaps) to build full URL list
// - Prepends priority URLs
// - Publishes URL_UPDATED one by one (serial, rate-limit friendly)
// - Re-submits sitemap every 50 URLs
// - Inspects 10 sample URLs at the end
// - Writes JSON + log report to logs/push-all-urls-<timestamp>.{json,log}

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const ENV_PATH = path.resolve(process.cwd(), '.env.local');
const SITE_URL = 'sc-domain:vocalis.pro';
const SITEMAP_URL = 'https://vocalis.pro/sitemap.xml';
const WWW_SITEMAP_URL = 'https://www.vocalis.pro/sitemap.xml';

const PRIORITY_URLS = [
  'https://vocalis.pro/',
  'https://vocalis.pro/about',
  'https://vocalis.pro/pricing',
  'https://vocalis.pro/contact',
  'https://vocalis.pro/solutions',
  'https://vocalis.pro/documentation',
  'https://vocalis.pro/blog',
  'https://vocalis.pro/metier-du-droit',
  'https://vocalis.pro/pour-agence-immobiliere',
  'https://vocalis.pro/chauffeur',
  'https://vocalis.pro/banque-et-assurance',
  'https://vocalis.pro/entreprise-de-construction',
];

const DELAY_BETWEEN_REQ_MS = 600; // serial, ~100 req/min
const RESUBMIT_SITEMAP_EVERY = 50;
const MAX_RETRIES = 3;

// ---------- utils ----------
function loadEnvLocal(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
}

function parseCredentials(raw) {
  if (!raw) throw new Error('GOOGLE_CREDENTIALS empty');
  const s = raw.trim();
  try { return JSON.parse(s); } catch {}
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {}
  if (fs.existsSync(s)) return JSON.parse(fs.readFileSync(s, 'utf8'));
  throw new Error('Could not parse GOOGLE_CREDENTIALS');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function banner(t) {
  const line = '='.repeat(72);
  console.log(`\n${line}\n${t}\n${line}`);
}

function nowTs() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ---------- sitemap fetch ----------
async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function extractTagValues(xml, tag) {
  const re = new RegExp(`<${tag}>\\s*([^<]+?)\\s*<\\/${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

async function fetchAllSitemapUrls(rootSitemap) {
  const visited = new Set();
  const urls = new Set();

  async function walk(sm) {
    if (visited.has(sm)) return;
    visited.add(sm);
    let xml;
    try {
      xml = await fetchText(sm);
    } catch (e) {
      console.log(`WARN fetch sitemap ${sm} failed: ${e.message}`);
      return;
    }
    // sitemap index?
    if (/<sitemapindex/i.test(xml)) {
      const nested = extractTagValues(xml, 'loc');
      console.log(`  index ${sm} -> ${nested.length} nested sitemaps`);
      for (const n of nested) await walk(n);
      return;
    }
    // urlset
    const locs = extractTagValues(xml, 'loc');
    console.log(`  sitemap ${sm} -> ${locs.length} URLs`);
    for (const u of locs) urls.add(u);
  }

  await walk(rootSitemap);
  return Array.from(urls);
}

// ---------- indexing publish w/ retry ----------
async function publishWithRetry(indexing, url) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const r = await indexing.urlNotifications.publish({
        requestBody: { url, type: 'URL_UPDATED' },
      });
      const latest = r.data?.urlNotificationMetadata?.latestUpdate;
      return { ok: true, notifyTime: latest?.notifyTime, attempt: attempt + 1 };
    } catch (e) {
      const code = e?.code || e?.response?.status;
      const msg = e?.errors?.[0]?.message || e?.message;
      attempt++;
      // 429 quota -> sleep 30s, keep retrying (up to MAX_RETRIES)
      if (code === 429) {
        if (attempt >= MAX_RETRIES) return { ok: false, code, msg, attempt, quotaExhausted: true };
        console.log(`     429 quota, sleep 30s then retry ${attempt}/${MAX_RETRIES}`);
        await sleep(30_000);
        continue;
      }
      // 403 -> skip immediately, no retry
      if (code === 403) {
        return { ok: false, code, msg, attempt, skip: true };
      }
      // 500 -> exponential backoff
      if (code >= 500) {
        if (attempt >= MAX_RETRIES) return { ok: false, code, msg, attempt };
        const backoff = 2000 * Math.pow(2, attempt - 1);
        console.log(`     ${code} server err, backoff ${backoff}ms retry ${attempt}/${MAX_RETRIES}`);
        await sleep(backoff);
        continue;
      }
      // other -> no retry
      return { ok: false, code, msg, attempt };
    }
  }
  return { ok: false, code: 'EXHAUSTED', msg: 'retries exhausted', attempt };
}

// ---------- main ----------
async function main() {
  banner('[STEP 0] Load credentials');
  const env = loadEnvLocal(ENV_PATH);
  const creds = parseCredentials(env.GOOGLE_CREDENTIALS);
  console.log(`client_email : ${creds.client_email}`);
  console.log(`project_id   : ${creds.project_id}`);

  const authIndexing = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });
  const authWebmasters = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/webmasters'],
  });
  await authIndexing.authorize();
  await authWebmasters.authorize();
  console.log('JWT authorized');

  const indexing = google.indexing({ version: 'v3', auth: authIndexing });
  const wm = google.webmasters({ version: 'v3', auth: authWebmasters });
  const sc = google.searchconsole({ version: 'v1', auth: authWebmasters });

  banner('[STEP 1] Fetch sitemap URLs');
  let sitemapUrls = [];
  try {
    sitemapUrls = await fetchAllSitemapUrls(SITEMAP_URL);
    console.log(`Total unique URLs from sitemap: ${sitemapUrls.length}`);
  } catch (e) {
    console.log(`WARN sitemap fetch failed: ${e.message}`);
  }

  // Build final ordered list (priority first, then rest dedup)
  const seen = new Set();
  const finalUrls = [];
  for (const u of [...PRIORITY_URLS, ...sitemapUrls]) {
    if (!seen.has(u)) { seen.add(u); finalUrls.push(u); }
  }
  console.log(`Final URL list size: ${finalUrls.length}`);

  banner('[STEP 2] Quota test (1 call on home)');
  const testRes = await publishWithRetry(indexing, 'https://vocalis.pro/');
  if (!testRes.ok && testRes.quotaExhausted) {
    console.log('QUOTA EXHAUSTED at first call. Aborting.');
    process.exit(2);
  }
  console.log(`test result: ok=${testRes.ok} code=${testRes.code ?? ''} notifyTime=${testRes.notifyTime ?? ''}`);

  banner(`[STEP 3] Publish ${finalUrls.length} URLs (serial, ${DELAY_BETWEEN_REQ_MS}ms spacing)`);
  const results = [];
  let successCount = 0;
  let failCount = 0;
  let stoppedAt = -1;

  // first URL already pushed in test - mark it
  if (testRes.ok) {
    results.push({ url: 'https://vocalis.pro/', ok: true, notifyTime: testRes.notifyTime });
    successCount++;
  }

  for (let i = 0; i < finalUrls.length; i++) {
    const url = finalUrls[i];
    // skip if this is the test URL we already pushed
    if (i === 0 && url === 'https://vocalis.pro/' && testRes.ok) continue;

    const r = await publishWithRetry(indexing, url);
    if (r.ok) {
      successCount++;
      console.log(`[${i + 1}/${finalUrls.length}] OK   ${url}  @ ${r.notifyTime}`);
      results.push({ url, ok: true, notifyTime: r.notifyTime });
    } else {
      failCount++;
      console.log(`[${i + 1}/${finalUrls.length}] FAIL ${url}  [${r.code}] ${r.msg}`);
      results.push({ url, ok: false, code: r.code, msg: r.msg });
      if (r.quotaExhausted) {
        stoppedAt = i;
        console.log(`\n>>> Quota exhausted after ${successCount} success, ${failCount} fail. Stopping at index ${i}.`);
        break;
      }
    }

    // re-submit sitemap every N successful URLs
    if (successCount > 0 && successCount % RESUBMIT_SITEMAP_EVERY === 0) {
      try {
        await wm.sitemaps.submit({ siteUrl: SITE_URL, feedpath: SITEMAP_URL });
        console.log(`     [sitemap resubmitted after ${successCount} successes]`);
      } catch (e) {
        console.log(`     [sitemap resubmit failed: ${e?.message}]`);
      }
    }

    await sleep(DELAY_BETWEEN_REQ_MS);
  }

  banner('[STEP 4] Final sitemap submit');
  try {
    await wm.sitemaps.submit({ siteUrl: SITE_URL, feedpath: SITEMAP_URL });
    console.log(`OK sitemap submitted: ${SITEMAP_URL}`);
  } catch (e) {
    console.log(`FAIL sitemap submit: ${e?.message}`);
  }
  try {
    await wm.sitemaps.submit({ siteUrl: SITE_URL, feedpath: WWW_SITEMAP_URL });
    console.log(`OK www sitemap submitted`);
  } catch (e) {
    console.log(`INFO www sitemap submit: ${e?.message}`);
  }

  // sitemaps list
  try {
    const list = await wm.sitemaps.list({ siteUrl: SITE_URL });
    const items = list.data?.sitemap || [];
    console.log(`\nRegistered sitemaps (${items.length}):`);
    for (const s of items) {
      console.log(`  - ${s.path}  lastSubmitted=${s.lastSubmitted}  isPending=${s.isPending}  errors=${s.errors}`);
    }
  } catch (e) {
    console.log(`INFO sitemaps list failed: ${e?.message}`);
  }

  banner('[STEP 5] Inspect 10 sample URLs (post-push status)');
  const successUrls = results.filter(r => r.ok).map(r => r.url);
  const sample = [];
  const step = Math.max(1, Math.floor(successUrls.length / 10));
  for (let i = 0; i < successUrls.length && sample.length < 10; i += step) sample.push(successUrls[i]);

  const inspections = [];
  for (const target of sample) {
    try {
      const r = await sc.urlInspection.index.inspect({
        requestBody: { inspectionUrl: target, siteUrl: SITE_URL, languageCode: 'fr-FR' },
      });
      const idx = r.data?.inspectionResult?.indexStatusResult;
      console.log(`\n-> ${target}`);
      console.log(`   verdict         : ${idx?.verdict}`);
      console.log(`   coverageState   : ${idx?.coverageState}`);
      console.log(`   indexingState   : ${idx?.indexingState}`);
      console.log(`   pageFetchState  : ${idx?.pageFetchState}`);
      console.log(`   lastCrawlTime   : ${idx?.lastCrawlTime}`);
      console.log(`   googleCanonical : ${idx?.googleCanonical}`);
      inspections.push({ url: target, idx });
    } catch (e) {
      console.log(`FAIL inspect ${target}: ${e?.message}`);
      inspections.push({ url: target, error: e?.message });
    }
    await sleep(500);
  }

  banner('[SUMMARY]');
  console.log(`Total URLs processed : ${results.length}`);
  console.log(`Success              : ${successCount}`);
  console.log(`Fail                 : ${failCount}`);
  if (stoppedAt >= 0) console.log(`STOPPED early at index ${stoppedAt} (quota). Resume tomorrow starting from: ${finalUrls[stoppedAt]}`);

  // write logs
  const logsDir = path.resolve(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const ts = nowTs();
  const jsonPath = path.join(logsDir, `push-all-urls-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    startedAt: ts,
    total: results.length,
    successCount,
    failCount,
    stoppedAt,
    resumeFrom: stoppedAt >= 0 ? finalUrls[stoppedAt] : null,
    results,
    inspections,
  }, null, 2));
  console.log(`\nLog written -> ${jsonPath}`);
}

main().catch(e => {
  console.error('FATAL:', e?.stack || e);
  process.exit(1);
});
