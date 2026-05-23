/**
 * recalc-tracked-volumes.mjs
 *
 * For every row in `tracked_keywords`:
 *   1. Recompute `current_position` and `current_impressions` from the LOCAL
 *      search_console_data table, filtered by the SITE's TLD country
 *      (FR → FRA, CH → CHE, BE → BEL, CA → CAN).
 *   2. Back-calculate `volume_market` from impressions / CTR at current position
 *      (CTR curve below — Sistrix 2024).
 *
 * Volume is only OVERWRITTEN when:
 *   - the row currently has no volume (volume_market IS NULL OR volume_market = 0),
 *   - OR `--force` flag is passed,
 *   - OR our back-calc is materially higher than the stored value
 *     (DataForSEO is often conservative).
 *
 * Usage:
 *   node scripts/recalc-tracked-volumes.mjs           # only fill NULL/0
 *   node scripts/recalc-tracked-volumes.mjs --force   # overwrite all
 *   node scripts/recalc-tracked-volumes.mjs --site 27 # one site only
 */

import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env.production (preferred) then env.local
function loadEnv(file) {
  try {
    const raw = readFileSync(join(__dirname, '..', file), 'utf8');
    for (const line of raw.split('\n')) {
      // Skip comments + empty
      if (!line.trim() || line.startsWith('#')) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+?)\s*$/);
      if (m) {
        let v = m[2];
        // Strip surrounding quotes
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!process.env[m[1]]) process.env[m[1]] = v.replace(/\\n/g, '\n');
      }
    }
  } catch (_e) {
    // file missing — ok
  }
}
loadEnv('.env.production');
loadEnv('.env.local');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — load .env.production or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// CTR by position (Sistrix 2024 SERP click distribution)
function ctrAtPosition(pos) {
  if (pos <= 1) return 0.32;
  if (pos <= 2) return 0.18;
  if (pos <= 3) return 0.12;
  if (pos <= 5) return 0.07;
  if (pos <= 7) return 0.04;
  if (pos <= 10) return 0.025;
  if (pos <= 15) return 0.012;
  if (pos <= 20) return 0.006;
  if (pos <= 30) return 0.003;
  if (pos <= 50) return 0.0015;
  return 0.0008;
}

// "Share of voice" — % of total searches where we appear at our current
// position. Used to back-calc volume from impressions.
function shareOfVoiceAt(pos) {
  if (pos <= 3) return 0.95;
  if (pos <= 10) return 0.80;
  if (pos <= 20) return 0.60;
  if (pos <= 50) return 0.45;
  if (pos <= 100) return 0.30;
  return 0.20;
}

function siteCountryCode(url) {
  if (!url) return 'FRA';
  let host = String(url).toLowerCase().trim().replace(/^sc-domain:/, '');
  try { if (host.includes('://')) host = new URL(host).hostname; } catch (_e) {}
  host = host.replace(/^www\./, '').replace(/\/+$/, '');
  const tld = host.split('.').pop() || '';
  if (tld === 'ch') return 'CHE';
  if (tld === 'be') return 'BEL';
  if (tld === 'ca') return 'CAN';
  return 'FRA';
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const siteArgIdx = args.indexOf('--site');
const siteId = siteArgIdx !== -1 ? parseInt(args[siteArgIdx + 1], 10) : null;

console.log(`[recalc] force=${force} site=${siteId ?? 'ALL'}`);

const sites = siteId
  ? await sql`SELECT id, name, url FROM sites WHERE id = ${siteId}`
  : await sql`SELECT id, name, url FROM sites WHERE is_active = true ORDER BY id`;

let totalUpdated = 0;
let totalSkipped = 0;
const samples = [];

for (const s of sites) {
  const cc = siteCountryCode(s.url);
  const kws = await sql`
    SELECT id, keyword, volume_market, volume_fr, current_position, current_impressions
    FROM tracked_keywords
    WHERE site_id = ${s.id} AND is_active = TRUE
  `;
  if (kws.length === 0) continue;
  console.log(`\n[${s.url}] (${cc}) — ${kws.length} keywords`);

  for (const k of kws) {
    // Pull 28d data from search_console_query_data (query-level, no page split).
    // This returns Google's REAL displayed position — the same number that appears
    // in the GSC UI. Page-level aggregation (search_console_data) over-counts deep
    // pages and drags weighted-avg positions to absurd values.
    // Position formula: impression-weighted average across daily rows (single page
    // per day in GSC's natural query aggregation, so the weighted avg IS the true pos).
    const r = await sql`
      SELECT
        COALESCE(SUM(impressions), 0)                                              AS impressions,
        COALESCE(SUM(clicks), 0)                                                   AS clicks,
        COALESCE(SUM(position * impressions) / NULLIF(SUM(impressions), 0), NULL)  AS position,
        AVG(NULLIF(position, 0))                                                   AS avg_position
      FROM search_console_query_data
      WHERE site_id = ${s.id}
        AND LOWER(query) = LOWER(${k.keyword})
        AND date >= CURRENT_DATE - INTERVAL '28 days'
        AND country = ${cc}
        AND position BETWEEN 1 AND 200
    `;
    const row = r[0] || {};
    const impressions28d = Number(row.impressions ?? 0);
    const clicks28d = Number(row.clicks ?? 0);
    const pos = row.position !== null && row.position !== undefined ? Number(row.position) : null;

    // No data → keep existing values, just refresh position to NULL if none
    if (!pos || impressions28d <= 0) {
      totalSkipped += 1;
      continue;
    }

    // 28d → 30d normalization
    const impr30 = Math.round(impressions28d * (30 / 28));
    const sov = shareOfVoiceAt(pos);
    // Method 1: impressions / share-of-voice (works at low positions too)
    const volFromSov = Math.round(impr30 / sov);
    // Method 2: clicks / ctr-at-pos (works best when clicks > 0)
    // Hard cap CTR at 0.5 — branded queries with 80% CTR otherwise destroy the math.
    const ctrSafe = Math.min(Math.max(ctrAtPosition(pos), 0.0005), 0.5);
    const volFromCtr = clicks28d > 0
      ? Math.round((clicks28d * (30 / 28)) / ctrSafe)
      : 0;
    // Conservative: take the LOWER of the two when both > 0, otherwise the available one.
    let calcVol;
    if (volFromSov > 0 && volFromCtr > 0) {
      calcVol = Math.min(volFromSov, volFromCtr);
    } else {
      calcVol = Math.max(volFromSov, volFromCtr);
    }
    // Sanity cap: 30d volume should never exceed impressions * 50 (else math broken)
    calcVol = Math.min(calcVol, Math.max(impr30 * 50, 100));

    const oldVol = Number(k.volume_market ?? 0);
    let nextVol = oldVol;
    if (force || oldVol <= 0 || (calcVol > oldVol * 2 && calcVol < oldVol * 100)) {
      // Only overwrite when materially higher AND not absurd (×100 = brand spike)
      nextVol = calcVol;
    }

    // Always refresh current_position + current_impressions (country-filtered)
    await sql`
      UPDATE tracked_keywords
      SET current_position = ${pos.toFixed(2)},
          current_impressions = ${impr30},
          current_clicks = ${Math.round(clicks28d * (30 / 28))},
          volume_market = ${nextVol},
          updated_at = NOW()
      WHERE id = ${k.id}
    `;
    totalUpdated += 1;
    if (samples.length < 5 && nextVol !== oldVol) {
      samples.push({
        site: s.url,
        keyword: k.keyword,
        oldPos: k.current_position,
        newPos: pos.toFixed(2),
        oldVol,
        newVol: nextVol,
        impr30,
        clicks28d,
      });
    }
  }
}

console.log(`\n[recalc] DONE — updated=${totalUpdated} skipped (no data)=${totalSkipped}`);
console.log('\nSamples (changed):');
for (const s of samples) {
  console.log(`  ${s.site} | "${s.keyword}"`);
  console.log(`    pos: ${s.oldPos} → ${s.newPos}, vol: ${s.oldVol} → ${s.newVol} (impr30d=${s.impr30}, clicks28d=${s.clicks28d})`);
}
