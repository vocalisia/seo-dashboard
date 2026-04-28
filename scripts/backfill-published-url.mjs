#!/usr/bin/env node
/**
 * Backfill `published_url` pour les autopilot_runs anciens où la colonne
 * était NULL (pré-migration). Reconstruit l'URL depuis github_url +
 * SITE_REPO_MAP (i18nBlogPath), teste qu'elle répond 200, puis UPDATE.
 *
 * Usage : node scripts/backfill-published-url.mjs [--apply]
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const APPLY = new Set(process.argv.slice(2)).has("--apply");
const ROOT = path.join(import.meta.dirname, "..");
const env = Object.fromEntries(
  [...fs.readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .matchAll(/^([A-Z0-9_]+)="?([\s\S]*?)"?$/gm)].map((m) => [m[1], m[2]])
);
const sql = neon(env.DATABASE_URL);

// site_id -> { siteUrl, blogPath }
const SITE_BLOG = {
  10: { siteUrl: "https://vocalis.blog", blogPath: "/blog" },   // vocalis.pro shares vocalis-blog repo, content lives at vocalis.blog
  11: { siteUrl: "https://vocalis.blog", blogPath: "/blog" },
  12: { siteUrl: "https://iapmesuisse.ch", blogPath: "/fr/blog" },
  13: { siteUrl: "https://ai-due.com", blogPath: "/fr/blog" },
  16: { siteUrl: "https://trust-vault.com", blogPath: "/fr/blog" },
  18: { siteUrl: "https://lead-gene.com", blogPath: "/fr/blog" },
  24: { siteUrl: "https://woman-cute.com", blogPath: "/fr/blog" },
};

const rows = await sql`
  SELECT id, site_id, keyword, github_url, status
  FROM autopilot_runs
  WHERE status = 'published' AND published_url IS NULL AND github_url IS NOT NULL
`;

console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
console.log(`Rows à backfiller: ${rows.length}\n`);

const probe = async u => { try { const r=await fetch(u,{redirect:"follow"}); return r.status; } catch { return "ERR"; } };

let ok = 0, fail = 0;
for (const r of rows) {
  const m = r.github_url.match(/\/blob\/[^/]+\/(.+)\.(mdx?|md)$/);
  const slug = m?.[1].split("/").pop();
  const conf = SITE_BLOG[r.site_id];
  if (!slug || !conf) {
    console.log(`✗ #${r.id} can't derive (slug=${slug}, conf=${!!conf})`);
    fail++; continue;
  }
  const url = `${conf.siteUrl}${conf.blogPath}/${slug}`;
  const status = await probe(url);
  if (!String(status).startsWith("2")) {
    console.log(`⚠️  #${r.id} ${slug} → ${status} ${url}`);
    fail++;
    continue;
  }
  console.log(`✓ #${r.id} → ${url}`);
  if (APPLY) {
    await sql`UPDATE autopilot_runs SET published_url = ${url} WHERE id = ${r.id}`;
  }
  ok++;
}

console.log(`\nDone. ok=${ok} fail=${fail}`);
if (!APPLY) console.log("Re-run with --apply to write.");
