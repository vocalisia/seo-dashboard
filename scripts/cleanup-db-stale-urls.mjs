#!/usr/bin/env node
/**
 * Phase 2 du nettoyage 404 : corrige les `published_url` de la DB
 * qui pointent vers une URL morte alors que le contenu est ailleurs (ou n'existe plus).
 *
 * - Vocalis Pro (site_id 10) : l'autopilot a écrit `vocalis.pro/blog/<slug>` mais le
 *   contenu vit dans le repo `vocalis-blog` qui sert `vocalis.blog`. On désindexe
 *   l'URL vocalis.pro et on remappe published_url vers la version vocalis.blog
 *   quand le slug existe vraiment côté blog.
 * - Lead-gene : entries avec published_url sans suffixe date (404) alors que le
 *   fichier réel a un suffixe `-YYYY-MM-DD`. On essaye d'abord de retrouver
 *   le fichier ; sinon on désindexe + status=cleaned_404.
 *
 * Usage : node scripts/cleanup-db-stale-urls.mjs [--apply]
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { google } from "googleapis";

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");

const ROOT = path.join(import.meta.dirname, "..");
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  [...envRaw.matchAll(/^([A-Z0-9_]+)="?([\s\S]*?)"?$/gm)].map((m) => [m[1], m[2]])
);

const sql = neon(env.DATABASE_URL);
const GH_TOKEN = env.GITHUB_TOKEN;

const auth = new google.auth.GoogleAuth({
  credentials: (() => {
    const c = JSON.parse(env.GOOGLE_CREDENTIALS);
    return { client_email: c.client_email, private_key: c.private_key.replace(/\\n/g, "\n") };
  })(),
  scopes: ["https://www.googleapis.com/auth/indexing"],
});

async function googleToken() {
  const c = await auth.getClient();
  const { token } = await c.getAccessToken();
  return token;
}

async function deindex(token, url) {
  const r = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url, type: "URL_DELETED" }),
  });
  return r.ok;
}

async function repoFileExists(repo, branch, filePath) {
  for (const b of [branch, "main", "master"]) {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${b}`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}` },
    });
    if (r.ok) return true;
  }
  return false;
}

async function probe(url) {
  try {
    const r = await fetch(url, { redirect: "follow" });
    return r.status;
  } catch { return "ERR"; }
}

console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

const token = APPLY ? await googleToken() : null;

// Pull all autopilot_runs whose published_url currently 404s and status='published'
const candidates = await sql`
  SELECT id, site_id, keyword, github_url, published_url, language, status, created_at
  FROM autopilot_runs
  WHERE status = 'published' AND published_url IS NOT NULL
  ORDER BY id
`;

console.log(`Candidates with published_url: ${candidates.length}\n`);

const actions = [];
for (const r of candidates) {
  const status = await probe(r.published_url);
  if (String(status).startsWith("2")) continue; // OK, skip

  const a = { id: r.id, keyword: r.keyword, oldUrl: r.published_url, oldStatus: status, plan: null };

  // Heuristic 1: vocalis.pro/blog/<slug> → vocalis.blog/blog/<slug> (same content repo)
  if (r.published_url.startsWith("https://vocalis.pro/blog/")) {
    const altUrl = r.published_url.replace("https://vocalis.pro/", "https://vocalis.blog/");
    const altStatus = await probe(altUrl);
    if (String(altStatus).startsWith("2")) {
      a.plan = { kind: "remap", newUrl: altUrl, deindexOld: true };
    } else {
      a.plan = { kind: "cleaned", deindexOld: true };
    }
  }
  // Heuristic 2: lead-gene.com/blog/<slug> without date → /fr/blog/<slug>-<date>
  else if (
    r.published_url.startsWith("https://lead-gene.com/") ||
    r.published_url.startsWith("https://woman-cute.com/blog/")
  ) {
    // Try /fr/blog/<slug> first (config fix only)
    const frUrl = r.published_url.replace(/^(https:\/\/[^/]+)\/blog\//, "$1/fr/blog/");
    const frStatus = await probe(frUrl);
    if (String(frStatus).startsWith("2")) {
      a.plan = { kind: "remap", newUrl: frUrl, deindexOld: true };
    } else if (r.github_url) {
      // Pull the actual filename from github_url (which has the date suffix)
      const m = r.github_url.match(/\/([^/]+)\.(mdx?|md)$/);
      const slug = m?.[1];
      if (slug) {
        const dateUrl = r.published_url.replace(/^(https:\/\/[^/]+)\/(?:fr\/)?blog\/[^?#]+/, `$1/fr/blog/${slug}`);
        const dateStatus = await probe(dateUrl);
        if (String(dateStatus).startsWith("2")) {
          a.plan = { kind: "remap", newUrl: dateUrl, deindexOld: true };
        } else {
          a.plan = { kind: "cleaned", deindexOld: true };
        }
      } else {
        a.plan = { kind: "cleaned", deindexOld: true };
      }
    } else {
      a.plan = { kind: "cleaned", deindexOld: true };
    }
  }
  // Heuristic 3: trust-vault /blog/* without /fr/ → /fr/blog/*
  else if (r.published_url.startsWith("https://trust-vault.com/blog/")) {
    const frUrl = r.published_url.replace("/blog/", "/fr/blog/");
    const frStatus = await probe(frUrl);
    if (String(frStatus).startsWith("2")) {
      a.plan = { kind: "remap", newUrl: frUrl, deindexOld: true };
    } else {
      a.plan = { kind: "cleaned", deindexOld: true };
    }
  }
  // Default: just mark cleaned + deindex
  else {
    a.plan = { kind: "cleaned", deindexOld: true };
  }

  actions.push(a);
}

console.log(`Plans:`);
for (const a of actions) {
  console.log(`\n#${a.id} [${a.oldStatus}] ${a.keyword}`);
  console.log(`  old: ${a.oldUrl}`);
  if (a.plan.kind === "remap") console.log(`  new: ${a.plan.newUrl}  (will UPDATE published_url)`);
  if (a.plan.kind === "cleaned") console.log(`  → status='cleaned_404'`);
  console.log(`  ${a.plan.deindexOld ? "+ deindex old URL on Google" : ""}`);
}

console.log(`\nTotal: ${actions.length} actions`);

if (!APPLY) {
  console.log("\nDry-run done. Re-run with --apply to execute.");
  process.exit(0);
}

let okDeindex = 0, okRemap = 0, okCleaned = 0;
for (const a of actions) {
  if (a.plan.deindexOld) {
    const ok = await deindex(token, a.oldUrl);
    if (ok) okDeindex++;
  }
  if (a.plan.kind === "remap") {
    await sql`UPDATE autopilot_runs SET published_url = ${a.plan.newUrl} WHERE id = ${a.id}`;
    okRemap++;
  } else if (a.plan.kind === "cleaned") {
    await sql`UPDATE autopilot_runs SET status = 'cleaned_404' WHERE id = ${a.id}`;
    okCleaned++;
  }
}

console.log(`\nDone. deindexed=${okDeindex} remapped=${okRemap} cleaned=${okCleaned}`);
