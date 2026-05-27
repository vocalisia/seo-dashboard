#!/usr/bin/env node
/**
 * GA4 Property ID Validator — validate-ga4-ids.mjs
 *
 * Checks every ga_property_id in the `sites` table for common errors:
 *   ❌ "properties/XXXXXX"  → double-prefix bug in sync-ga4.mjs
 *   ❌ "G-XXXXXXXXXX"       → Measurement ID stored instead of Property ID
 *   ❌ null / empty         → not configured (warning only)
 *   ✅ "XXXXXXXXX"          → numeric string, correct format
 *
 * Usage:
 *   node scripts/validate-ga4-ids.mjs          # validate only, exit 1 if errors
 *   node scripts/validate-ga4-ids.mjs --fix    # auto-strip "properties/" prefix in DB
 *
 * Auto-run: added to prebuild in package.json
 */

import { readFileSync, existsSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_MODE = process.argv.includes('--fix');

// Load env
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
  } catch (_e) {}
}
loadEnvFile('.env.production');
loadEnvFile('.env.local');

if (!process.env.DATABASE_URL) {
  console.log('⚠  DATABASE_URL not set — skipping DB validation (local dev)');
  process.exit(0);
}

const sql = neon(process.env.DATABASE_URL);

const DOUBLE_PREFIX = /^properties\//;
const MEASUREMENT_ID = /^G-[A-Z0-9]+$/i;
const NUMERIC_ID = /^\d+$/;

const sites = await sql`SELECT id, name, ga_property_id FROM sites WHERE is_active = true ORDER BY name`;

let errors = 0;
let warnings = 0;
let fixed = 0;

console.log(`\n🔍 GA4 Property ID Validation — ${sites.length} sites\n`);

for (const site of sites) {
  const raw = site.ga_property_id;
  const name = site.name;

  if (!raw) {
    console.log(`⚠️  [WARN] ${name}: ga_property_id is NULL — dashboard shows "Non configuré"`);
    warnings++;
    continue;
  }

  if (DOUBLE_PREFIX.test(raw)) {
    console.log(`❌ [ERROR] ${name}: ga_property_id has "properties/" prefix → "${raw}"`);
    console.log(`   → Fix: UPDATE sites SET ga_property_id='${raw.replace('properties/', '')}' WHERE id=${site.id};`);
    errors++;

    if (FIX_MODE) {
      const fixed_id = raw.replace(/^properties\//, '');
      await sql`UPDATE sites SET ga_property_id = ${fixed_id} WHERE id = ${site.id}`;
      console.log(`   ✅ Auto-fixed to: "${fixed_id}"`);
      fixed++;
    }
    continue;
  }

  if (MEASUREMENT_ID.test(raw)) {
    console.log(`❌ [ERROR] ${name}: ga_property_id is a Measurement ID → "${raw}"`);
    console.log(`   → Fix: Find numeric Property ID in GA4 Admin > Property Settings > Property ID`);
    console.log(`          UPDATE sites SET ga_property_id='XXXXXXXX' WHERE id=${site.id};`);
    errors++;
    continue;
  }

  if (!NUMERIC_ID.test(raw)) {
    console.log(`⚠️  [WARN] ${name}: ga_property_id has unexpected format → "${raw}"`);
    warnings++;
    continue;
  }

  console.log(`✅ [OK]   ${name}: ${raw}`);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${sites.length - errors - warnings} OK | ${errors} errors | ${warnings} warnings`);
if (FIX_MODE && fixed > 0) console.log(`Auto-fixed: ${fixed} entries`);

if (errors > 0) {
  console.log('\n🚨 GA4 VALIDATION FAILED — fix errors above before deploying');
  console.log('   Run with --fix to auto-repair "properties/" prefix errors\n');
  process.exit(1);
}

if (warnings > 0) {
  console.log('\n⚠  Warnings found — review above, sync will skip these sites');
}

console.log('\n✅ All GA4 property IDs are valid\n');
process.exit(0);
