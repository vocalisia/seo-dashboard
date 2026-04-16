#!/usr/bin/env node
// Force Google to re-crawl www.vocalis.pro after 308 redirect fix
// Uses Indexing API + Search Console (Webmasters) API + URL Inspection

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const ENV_PATH = path.resolve(process.cwd(), '.env.local');

function loadEnvLocal(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    // strip surrounding single/double quotes if present
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
}

function parseCredentials(raw) {
  if (!raw) throw new Error('GOOGLE_CREDENTIALS empty');
  let s = raw.trim();
  // try direct JSON
  try { return JSON.parse(s); } catch {}
  // try base64
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {}
  // maybe a file path
  if (fs.existsSync(s)) {
    return JSON.parse(fs.readFileSync(s, 'utf8'));
  }
  throw new Error('Could not parse GOOGLE_CREDENTIALS (not JSON, not base64, not file path)');
}

function banner(t) {
  const line = '='.repeat(72);
  console.log(`\n${line}\n${t}\n${line}`);
}

async function main() {
  banner('[STEP 0] Load credentials from .env.local');
  const env = loadEnvLocal(ENV_PATH);
  const creds = parseCredentials(env.GOOGLE_CREDENTIALS);
  console.log(`client_email   : ${creds.client_email}`);
  console.log(`project_id     : ${creds.project_id}`);

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
  console.log('JWT authorized for indexing + webmasters scopes');

  const indexing = google.indexing({ version: 'v3', auth: authIndexing });
  const wm = google.webmasters({ version: 'v3', auth: authWebmasters });
  const sc = google.searchconsole({ version: 'v1', auth: authWebmasters });

  const indexingUrls = [
    'https://www.vocalis.pro/robots.txt',
    'https://www.vocalis.pro/',
    'https://www.vocalis.pro/sitemap.xml',
    'https://vocalis.pro/robots.txt',
    'https://vocalis.pro/sitemap.xml',
  ];

  banner('[STEP 1] Push URL_UPDATED notifications via Indexing API');
  const indexingResults = [];
  for (const url of indexingUrls) {
    try {
      const r = await indexing.urlNotifications.publish({
        requestBody: { url, type: 'URL_UPDATED' },
      });
      const latest = r.data?.urlNotificationMetadata?.latestUpdate;
      console.log(`OK   ${url}`);
      console.log(`     notifyTime=${latest?.notifyTime ?? '?'} type=${latest?.type ?? '?'}`);
      indexingResults.push({ url, ok: true, notifyTime: latest?.notifyTime });
    } catch (e) {
      const code = e?.code || e?.response?.status;
      const msg = e?.errors?.[0]?.message || e?.message;
      console.log(`FAIL ${url}  [${code}] ${msg}`);
      indexingResults.push({ url, ok: false, code, msg });
      if (code === 429) {
        console.log('     >>> Indexing API quota 429 detected. Continuing with remaining URLs + webmasters API.');
      }
    }
  }

  banner('[STEP 2] Re-submit sitemap via webmasters.sitemaps.submit');
  // sc-domain:vocalis.pro  (Domain property — recognises both apex + www)
  const siteUrl = 'sc-domain:vocalis.pro';
  const sitemapUrl = 'https://vocalis.pro/sitemap.xml';
  try {
    await wm.sitemaps.submit({ siteUrl, feedpath: sitemapUrl });
    console.log(`OK   sitemap submitted: ${sitemapUrl} (site=${siteUrl})`);
  } catch (e) {
    const code = e?.code || e?.response?.status;
    console.log(`FAIL sitemap submit [${code}] ${e?.errors?.[0]?.message || e?.message}`);
  }

  // Also try the www sitemap in case it exists
  try {
    await wm.sitemaps.submit({ siteUrl, feedpath: 'https://www.vocalis.pro/sitemap.xml' });
    console.log(`OK   sitemap submitted: https://www.vocalis.pro/sitemap.xml`);
  } catch (e) {
    const code = e?.code || e?.response?.status;
    console.log(`INFO www sitemap submit [${code}] ${e?.errors?.[0]?.message || e?.message}`);
  }

  // Show current sitemaps status
  try {
    const list = await wm.sitemaps.list({ siteUrl });
    const items = list.data?.sitemap || [];
    console.log(`\nSitemaps registered on ${siteUrl}:`);
    for (const s of items) {
      console.log(`  - ${s.path}`);
      console.log(`      lastSubmitted=${s.lastSubmitted}  lastDownloaded=${s.lastDownloaded}  isPending=${s.isPending}  errors=${s.errors}  warnings=${s.warnings}`);
    }
  } catch (e) {
    console.log(`INFO sitemaps list failed: ${e?.message}`);
  }

  banner('[STEP 3] URL inspection on https://www.vocalis.pro/');
  const inspectTargets = [
    'https://www.vocalis.pro/',
    'https://www.vocalis.pro/robots.txt',
    'https://vocalis.pro/',
  ];
  const inspectionResults = {};
  for (const target of inspectTargets) {
    try {
      const r = await sc.urlInspection.index.inspect({
        requestBody: {
          inspectionUrl: target,
          siteUrl,
          languageCode: 'fr-FR',
        },
      });
      const idx = r.data?.inspectionResult?.indexStatusResult;
      console.log(`\n-> ${target}`);
      console.log(`   verdict           : ${idx?.verdict}`);
      console.log(`   coverageState     : ${idx?.coverageState}`);
      console.log(`   robotsTxtState    : ${idx?.robotsTxtState}`);
      console.log(`   indexingState     : ${idx?.indexingState}`);
      console.log(`   pageFetchState    : ${idx?.pageFetchState}`);
      console.log(`   lastCrawlTime     : ${idx?.lastCrawlTime}`);
      console.log(`   googleCanonical   : ${idx?.googleCanonical}`);
      console.log(`   userCanonical     : ${idx?.userCanonical}`);
      console.log(`   crawledAs         : ${idx?.crawledAs}`);
      console.log(`   referringUrls     : ${(idx?.referringUrls || []).slice(0, 3).join(', ')}`);
      console.log(`   sitemap           : ${(idx?.sitemap || []).join(', ')}`);
      inspectionResults[target] = idx;
    } catch (e) {
      const code = e?.code || e?.response?.status;
      console.log(`FAIL inspect ${target} [${code}] ${e?.errors?.[0]?.message || e?.message}`);
      inspectionResults[target] = { error: e?.message };
    }
  }

  banner('[SUMMARY]');
  console.log('Indexing API push:');
  for (const r of indexingResults) {
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.url}${r.ok ? '  @ ' + r.notifyTime : '  ' + r.code + ' ' + r.msg}`);
  }
  console.log('\nURL inspection on www.vocalis.pro/ :');
  const main = inspectionResults['https://www.vocalis.pro/'];
  if (main && !main.error) {
    console.log(`  coverage        = ${main.coverageState}`);
    console.log(`  verdict         = ${main.verdict}`);
    console.log(`  googleCanonical = ${main.googleCanonical}`);
    console.log(`  userCanonical   = ${main.userCanonical}`);
    console.log(`  lastCrawlTime   = ${main.lastCrawlTime}`);
    console.log(`  pageFetchState  = ${main.pageFetchState}`);
  } else {
    console.log(`  (inspection failed: ${main?.error})`);
  }
}

main().catch(e => {
  console.error('FATAL:', e?.stack || e);
  process.exit(1);
});
