#!/usr/bin/env node
/**
 * Cleanup global de TOUS les 404 autopilot (toutes statuts confondus).
 * Couvre le trou laissé par cleanup-404-articles.mjs (qui ne traitait que
 * les `status='published'`) : `failed_quality`, `failed`, etc. ont aussi
 * poussé des fichiers sur GitHub → URLs 404 silencieuses.
 *
 * Pour chaque run avec github_url :
 *   - Calcule l'URL publique (published_url, sinon dérivée du github_url)
 *   - HTTP probe
 *   - Si 200 → skip
 *   - Si 404 :
 *       1. Tente un REMAP (vocalis.pro→vocalis.blog ; /blog→/fr/blog) si l'URL alt est 200
 *       2. Sinon → deindex Google + delete GitHub + status='cleaned_404'
 *
 * Usage : node scripts/cleanup-all-404.mjs [--apply]
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

async function probe(url) {
  try {
    const r = await fetch(url, { redirect: "follow" });
    return r.status;
  } catch { return "ERR"; }
}

async function deleteGithubFile(repo, branch, filePath) {
  // Get sha
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return { ok: false, status: r.status, msg: "file not found" };
  const j = await r.json();
  const del = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message: "chore: cleanup orphan 404 article (cleanup-all-404)",
      sha: j.sha,
      branch,
    }),
  });
  return { ok: del.ok, status: del.status };
}

console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

const sites = await sql`SELECT id, name, url FROM sites`;
const siteById = Object.fromEntries(sites.map((s) => [s.id, s]));

// All runs with github_url, except already cleaned
const runs = await sql`
  SELECT id, site_id, keyword, github_url, published_url, language, status
  FROM autopilot_runs
  WHERE github_url IS NOT NULL
    AND status <> 'cleaned_404'
    AND status <> 'dry_run'
  ORDER BY id
`;

console.log(`Candidates (status != cleaned_404, with github_url): ${runs.length}`);

// Build URL guesses for each row
const FR_BLOG_SITES = new Set([12, 13, 16, 18, 24]);

function guessUrl(r) {
  if (r.published_url) return r.published_url;
  const m = r.github_url.match(/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/(.+)\.(mdx?|md)$/);
  if (!m) return null;
  const slug = m[1].split("/").pop();
  const site = siteById[r.site_id];
  if (!site) return null;
  const blog = FR_BLOG_SITES.has(r.site_id) ? "/fr/blog" : "/blog";
  return `${site.url.replace(/\/$/, "")}${blog}/${slug}`;
}

function altUrlsFor(url) {
  const alts = [];
  // vocalis.pro shares repo with vocalis.blog
  if (url.startsWith("https://vocalis.pro/")) {
    alts.push(url.replace("https://vocalis.pro/", "https://vocalis.blog/"));
  }
  // /blog/ → /fr/blog/
  if (/\/blog\//.test(url) && !/\/fr\/blog\//.test(url)) {
    alts.push(url.replace("/blog/", "/fr/blog/"));
  }
  // tesla-mag uses /produit/
  if (url.includes("tesla-mag.ch/blog/")) {
    alts.push(url.replace("/blog/", "/produit/"));
  }
  return alts;
}

function parseGithub(githubUrl) {
  const m = githubUrl.match(/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { repo: m[1], branch: m[2], path: m[3] };
}

const tasks = [];
for (const r of runs) {
  const url = guessUrl(r);
  if (!url) continue;
  const status = await probe(url);
  if (String(status).startsWith("2")) continue; // OK, skip
  if (String(status).startsWith("3")) continue; // redirect already followed = OK
  if (status === "ERR") continue; // DNS dead, ignore
  if (status !== 404 && status !== 410) continue;

  const task = { run: r, url, status, plan: null };
  for (const alt of altUrlsFor(url)) {
    const altSt = await probe(alt);
    if (String(altSt).startsWith("2")) {
      task.plan = { kind: "remap", newUrl: alt };
      break;
    }
  }
  if (!task.plan) task.plan = { kind: "cleanup" };
  tasks.push(task);
}

console.log(`\nActions à exécuter: ${tasks.length}`);
const remaps = tasks.filter((t) => t.plan.kind === "remap");
const cleanups = tasks.filter((t) => t.plan.kind === "cleanup");
console.log(`  - Remaps (URL DB corrigée, fichier conservé): ${remaps.length}`);
console.log(`  - Cleanups (Google deindex + GitHub delete + cleaned_404): ${cleanups.length}`);

console.log("\n--- REMAPS ---");
for (const t of remaps) {
  console.log(`#${t.run.id} ${t.run.keyword}\n  ${t.url} → ${t.plan.newUrl}`);
}
console.log("\n--- CLEANUPS ---");
for (const t of cleanups) {
  const gh = parseGithub(t.run.github_url ?? "");
  console.log(`#${t.run.id} [${t.run.status}] ${t.run.keyword}`);
  console.log(`  url: ${t.url}`);
  console.log(`  file: ${gh ? `${gh.repo}@${gh.branch}:${gh.path}` : "?"}`);
}

if (!APPLY) {
  console.log("\nDry-run. Re-run with --apply to execute.");
  process.exit(0);
}

const token = await googleToken();
let nDeindex = 0, nGhDel = 0, nDb = 0;

for (const t of remaps) {
  await sql`UPDATE autopilot_runs SET published_url = ${t.plan.newUrl} WHERE id = ${t.run.id}`;
  // also deindex the dead URL
  if (await deindex(token, t.url)) nDeindex++;
  nDb++;
}

for (const t of cleanups) {
  const gh = parseGithub(t.run.github_url ?? "");
  if (await deindex(token, t.url)) nDeindex++;
  if (gh) {
    const out = await deleteGithubFile(gh.repo, gh.branch, gh.path);
    if (out.ok) nGhDel++;
    else console.log(`  ! gh delete failed for ${gh.repo}:${gh.path} (${out.status})`);
  }
  await sql`UPDATE autopilot_runs SET status = 'cleaned_404' WHERE id = ${t.run.id}`;
  nDb++;
}

console.log(`\nDone. deindex=${nDeindex} gh_deleted=${nGhDel} db_updated=${nDb}`);
