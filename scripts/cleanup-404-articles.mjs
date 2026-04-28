#!/usr/bin/env node
/**
 * Cleanup-404-articles.mjs
 *
 * Nettoie les articles autopilot orphelins en 404 :
 *   1. Soumet l'URL publique à Google Indexing API en `URL_DELETED`
 *   2. Supprime le fichier .mdx du repo GitHub (DELETE /repos/.../contents/...)
 *   3. Met à jour autopilot_runs.status = 'cleaned_404' en DB
 *
 * Usage :
 *   node scripts/cleanup-404-articles.mjs              # dry-run, n'écrit rien
 *   node scripts/cleanup-404-articles.mjs --apply      # exécute pour de vrai
 *   node scripts/cleanup-404-articles.mjs --apply --skip-google
 *   node scripts/cleanup-404-articles.mjs --apply --skip-github
 *   node scripts/cleanup-404-articles.mjs --apply --skip-db
 *
 * Pré-requis dans .env.local : DATABASE_URL, GITHUB_TOKEN, GOOGLE_CREDENTIALS.
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { google } from "googleapis";

// ---------- args + env -------------------------------------------------------
const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const SKIP_GOOGLE = argv.has("--skip-google");
const SKIP_GITHUB = argv.has("--skip-github");
const SKIP_DB = argv.has("--skip-db");

const ROOT = path.join(import.meta.dirname, "..");
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  [...envRaw.matchAll(/^([A-Z0-9_]+)="?([\s\S]*?)"?$/gm)].map((m) => [m[1], m[2]])
);

const DB_URL = env.DATABASE_URL;
const GH_TOKEN = env.GITHUB_TOKEN;
const GOOGLE_CREDS_RAW = env.GOOGLE_CREDENTIALS;

if (!DB_URL) throw new Error("DATABASE_URL missing in .env.local");
if (!GH_TOKEN && !SKIP_GITHUB) throw new Error("GITHUB_TOKEN missing");
if (!GOOGLE_CREDS_RAW && !SKIP_GOOGLE) throw new Error("GOOGLE_CREDENTIALS missing");

const sql = neon(DB_URL);

// Targets list — produced by the audit step (see ARTICLES_STATUS.md)
const TARGETS_FILE = path.join(ROOT, "scripts", "_404_targets.json");
if (!fs.existsSync(TARGETS_FILE)) {
  throw new Error(`Run the audit first: ${TARGETS_FILE} not found`);
}
const targets = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));

// ---------- helpers ----------------------------------------------------------
function buildGoogleAuth() {
  if (SKIP_GOOGLE) return null;
  const creds = JSON.parse(GOOGLE_CREDS_RAW);
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/indexing"],
  });
}

async function googleAccessToken(auth) {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("No Google access token");
  return token;
}

async function deindexUrl(token, url) {
  const r = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, type: "URL_DELETED" }),
  });
  if (!r.ok) {
    const txt = await r.text();
    return { ok: false, status: r.status, error: txt };
  }
  return { ok: true };
}

async function deleteRepoFile({ repo, path: filePath, branch, sha }) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message: `chore: remove orphan autopilot article (404 cleanup)`,
      sha,
      branch,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    return { ok: false, status: r.status, error: txt };
  }
  return { ok: true };
}

async function markCleanedInDb(publishedUrl) {
  const rows = await sql`
    UPDATE autopilot_runs
    SET status = 'cleaned_404'
    WHERE published_url = ${publishedUrl}
      AND status <> 'cleaned_404'
    RETURNING id
  `;
  return rows.length;
}

async function markCleanedByGithubUrl(githubBlobUrl) {
  // Some old runs only have github_url, not published_url
  const rows = await sql`
    UPDATE autopilot_runs
    SET status = 'cleaned_404'
    WHERE github_url = ${githubBlobUrl}
      AND status <> 'cleaned_404'
    RETURNING id
  `;
  return rows.length;
}

// ---------- main -------------------------------------------------------------
console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}`);
console.log(`Targets: ${targets.length} files\n`);

const auth = buildGoogleAuth();
const googleToken = auth && APPLY && !SKIP_GOOGLE ? await googleAccessToken(auth) : null;

const report = [];

for (const t of targets) {
  const [owner, repoName] = t.repo.split("/");
  const blobUrl = `https://github.com/${owner}/${repoName}/blob/${t.branch}/${t.path}`;
  const r = { ...t, blobUrl, actions: [] };

  // 1. Google deindex (one URL_DELETED per URL variant — usually 1)
  for (const url of t.urls) {
    if (SKIP_GOOGLE) {
      r.actions.push(`google: SKIP ${url}`);
      continue;
    }
    if (!APPLY) {
      r.actions.push(`google: would deindex ${url}`);
      continue;
    }
    const out = await deindexUrl(googleToken, url);
    r.actions.push(
      out.ok
        ? `google: deindexed ${url}`
        : `google: FAILED ${url} (${out.status}: ${out.error.slice(0, 200)})`
    );
  }

  // 2. GitHub delete file
  if (SKIP_GITHUB) {
    r.actions.push(`github: SKIP ${t.path}`);
  } else if (!APPLY) {
    r.actions.push(`github: would delete ${t.repo}@${t.branch}:${t.path}`);
  } else {
    const out = await deleteRepoFile(t);
    r.actions.push(
      out.ok
        ? `github: deleted ${t.repo}:${t.path}`
        : `github: FAILED ${t.repo}:${t.path} (${out.status}: ${out.error.slice(0, 200)})`
    );
  }

  // 3. DB update
  if (SKIP_DB) {
    r.actions.push(`db: SKIP`);
  } else if (!APPLY) {
    r.actions.push(`db: would mark cleaned_404 (by published_url + by github_url)`);
  } else {
    let totalUpdated = 0;
    for (const url of t.urls) {
      totalUpdated += await markCleanedInDb(url);
    }
    totalUpdated += await markCleanedByGithubUrl(blobUrl);
    r.actions.push(`db: marked ${totalUpdated} run(s) cleaned_404`);
  }

  report.push(r);
  console.log(`\n✦ ${t.repo}/${t.path}`);
  for (const a of r.actions) console.log(`   - ${a}`);
}

const reportFile = path.join(
  ROOT,
  "scripts",
  `_cleanup_report_${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(`\nReport saved to ${reportFile}`);

if (!APPLY) {
  console.log(
    "\nDRY-RUN done. Re-run with --apply to actually deindex, delete files, and update DB."
  );
}
