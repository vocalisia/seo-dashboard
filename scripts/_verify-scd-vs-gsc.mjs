// scripts/_verify-scd-vs-gsc.mjs
// Verify SCD post-dedup vs live GSC for last 3 fully-reported days.
// Reads gsc_raw.json baseline from C:/tmp/seo-recon/.

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";

function loadEnv(p) {
  if (!existsSync(p)) return;
  const env = readFileSync(p, "utf-8");
  for (const l of env.split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnv("C:/Users/cohen.000/seo-dashboard/.env.local");
loadEnv("C:/Users/cohen.000/seo-dashboard/.env.production");

const sql = neon(process.env.DATABASE_URL);

const liveRaw = JSON.parse(readFileSync("C:/tmp/seo-recon/gsc_raw.json", "utf-8"));

// gsc_raw.json shape unknown — peek
const siteName = "Vocalis Pro";

const liveSite = liveRaw[siteName] || liveRaw["vocalis.pro"] || liveRaw["https://vocalis.pro/"] || null;
console.log(`[verify] gsc_raw.json keys: ${Object.keys(liveRaw).slice(0,10).join(", ")}...`);
console.log(`[verify] live entry for ${siteName}:`, liveSite ? "found" : "MISSING");

const scd = await sql`
  SELECT s.name,
         COUNT(*)::int                AS rows,
         SUM(d.clicks)::int           AS clicks,
         SUM(d.impressions)::int      AS impressions,
         ROUND(AVG(NULLIF(d.position,0))::numeric, 1) AS pos,
         MIN(d.date)::text            AS dmin,
         MAX(d.date)::text            AS dmax
  FROM search_console_data d
  JOIN sites s ON s.id = d.site_id
  WHERE s.is_active = true
    AND d.date >= CURRENT_DATE - (3 - 1 + 3)
    AND d.date <= CURRENT_DATE - 3
    AND (d.country IS NULL OR d.country = '')
  GROUP BY s.name
  ORDER BY clicks DESC
`;

console.log("\n[verify] SCD totals (last 3d, GSC-lag-aware, country='' only):");
for (const r of scd) {
  console.log(`  ${r.name.padEnd(20)}  clk=${String(r.clicks).padStart(5)}  imp=${String(r.impressions).padStart(6)}  pos=${String(r.pos).padStart(5)}  rows=${String(r.rows).padStart(5)}  dates=${r.dmin}..${r.dmax}`);
}

// also country-aware totals (sum of country-split rows)
const scdCountry = await sql`
  SELECT s.name,
         SUM(d.clicks)::int      AS clicks,
         SUM(d.impressions)::int AS impressions
  FROM search_console_data d
  JOIN sites s ON s.id = d.site_id
  WHERE s.is_active = true
    AND d.date >= CURRENT_DATE - (3 - 1 + 3)
    AND d.date <= CURRENT_DATE - 3
    AND d.country IS NOT NULL AND d.country <> ''
  GROUP BY s.name
  ORDER BY clicks DESC
`;
console.log("\n[verify] SCD totals (last 3d, country-tagged rows only — should ~match country='' rows):");
for (const r of scdCountry) {
  console.log(`  ${r.name.padEnd(20)}  clk=${String(r.clicks).padStart(5)}  imp=${String(r.impressions).padStart(6)}`);
}

// reference live values from final_report.md (3d window 2026-05-16..05-19)
const liveRef = {
  "Vocalis Pro":   { clicks: 10, imp: 1017 },
  "IAPME Suisse":  { clicks:  0, imp:  141 },
  "CBD Europa":    { clicks:  0, imp:  119 },
  "Vocalis Blog":  { clicks:  0, imp:   99 },
  "Vocalis AI":    { clicks:  3, imp:   74 },
  "Trustly AI":    { clicks:  0, imp:   57 },
};

console.log("\n[verify] Drift vs live GSC (final_report.md 2026-05-16..05-19 baseline):");
for (const r of scd) {
  const ref = liveRef[r.name];
  if (!ref) continue;
  const driftClk = ref.clicks > 0 ? (((r.clicks - ref.clicks) / ref.clicks) * 100).toFixed(1) : (r.clicks === 0 ? "0.0" : "n/a");
  const driftImp = ref.imp > 0 ? (((r.impressions - ref.imp) / ref.imp) * 100).toFixed(1) : (r.impressions === 0 ? "0.0" : "n/a");
  console.log(`  ${r.name.padEnd(20)} live ${ref.clicks}/${ref.imp}  scd ${r.clicks}/${r.impressions}  drift clk ${driftClk}%  imp ${driftImp}%`);
}
