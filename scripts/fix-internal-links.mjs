// Fix internal links in all articles published today
// 1. List today's published articles from DB
// 2. Fetch each from GitHub
// 3. Validate + rewrite links against real repo slugs
// 4. PUT fixed content back to GitHub
//
// Requires .env.local in cwd with DATABASE_URL and GITHUB_TOKEN.
// Run: npm run fix:internal-links

import fs from "fs";
import { neon } from "@neondatabase/serverless";

const raw = fs.readFileSync(".env.local", "utf8");
const env = Object.fromEntries(
  raw.split("\n")
    .filter(l => l.includes("="))
    .map(l => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "")];
    })
);

const sql = neon(env.DATABASE_URL);
const GH_TOKEN = env.GITHUB_TOKEN;

// Site config — repo + i18n blog path (URL prefix)
// Per-language prefix. Fallback to first available if language not in map.
const SITE_CONFIG = {
  "vocalisia/vocalis-blog":              { blogPath: { fr: "/blog", en: "/blog", default: "/blog" }, articlePath: "content/blog" },
  "vocalisia/tesla-mag":                 { blogPath: { fr: "/produit", en: "/product", default: "/produit" }, articlePath: "src/data/articles" },
  "vocalisia/trust-vault":               { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/posts" },
  "vocalisia/trust-ai-blog":             { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/blog" },
  "vocalisia/iapmesuisse":               { blogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" }, articlePath: "content/blog/fr" },
  "vocalisia/hub-ai":                    { blogPath: { fr: "/fr/blog", en: "/en/blog", it: "/it/blog", de: "/de/blog", default: "/fr/blog" }, articlePath: "content/blog" },
  "vocalisia/vocalis-ai":                { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/blog" },
  "vocalisia/cbd-europa":                { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/blog" },
  "vocalisia/agents-ia-pro":             { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/blog" },
  "vocalisia/master-seller":             { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/blog" },
  "vocalisia/agent-whatsapp-ia-business":{ blogPath: { fr: "/fr/blog", en: "/en/blog", de: "/de/blog", default: "/fr/blog" }, articlePath: "content/blog" },
  "vocalisia/lead-gene":                 { blogPath: { fr: "/fr/blog", en: "/en/blog", de: "/de/blog", nl: "/nl/blog", default: "/fr/blog" }, articlePath: "content/blog" },
  "vocalisia/geoleads":                  { blogPath: { fr: "/fr/blog", en: "/en/blog", de: "/de/blog", default: "/fr/blog" }, articlePath: "content/blog" },
  "vocalisia/seo-true":                  { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/blog" },
  "vocalisia/woman-cute":                { blogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" }, articlePath: "content/blog" },
  "vocalisia/fitnessmaison":             { blogPath: { fr: "/blog", default: "/blog" }, articlePath: "content/blog" },
};

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  return res;
}

// List all slug files in a repo's articlePath (try master then main)
const slugCache = new Map();
async function listRepoSlugs(repo, articlePath) {
  const key = `${repo}|${articlePath}`;
  if (slugCache.has(key)) return slugCache.get(key);

  for (const branch of ["master", "main"]) {
    const res = await gh(`/repos/${repo}/contents/${articlePath}?ref=${branch}`);
    if (!res.ok) continue;
    const data = await res.json();
    if (!Array.isArray(data)) continue;
    const slugs = data
      .filter(f => f.type === "file" && /\.(mdx?|md)$/.test(f.name))
      .map(f => f.name.replace(/\.(mdx?|md)$/, ""));
    slugCache.set(key, { slugs, branch });
    return { slugs, branch };
  }
  slugCache.set(key, { slugs: [], branch: "master" });
  return { slugs: [], branch: "master" };
}

// Parse current filename from github_url to extract slug + detect language
function parseGhUrl(url) {
  // https://github.com/owner/repo/blob/branch/path/to/file.mdx
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, repo, branch, filePath] = m;
  const filename = filePath.split("/").pop();
  const dir = filePath.slice(0, -(filename.length + 1));
  const slug = filename.replace(/\.(mdx?|md)$/, "");
  return { repo, branch, filePath, dir, filename, slug };
}

// Detect language from filename prefix (e.g. "en-foo-2026-01-01" → en, else fr)
function detectLang(slug) {
  const m = slug.match(/^([a-z]{2})-/);
  if (!m) return "fr";
  const code = m[1];
  if (["en", "de", "it", "es", "nl", "pt"].includes(code)) return code;
  return "fr";
}

// Fix links in content
function fixLinks(content, { repo, selfSlug, articleLang }) {
  const cfg = SITE_CONFIG[repo];
  if (!cfg) return { content, stats: { skipped: true } };

  const cache = slugCache.get(`${repo}|${cfg.articlePath}`);
  let validSlugs = (cache?.slugs || []).filter(s => s !== selfSlug);
  // Fallback: if repository only has one article, use self slug as replacement target.
  if (validSlugs.length === 0 && selfSlug) validSlugs = [selfSlug];
  if (validSlugs.length === 0) return { content, stats: { skipped: true, reason: "no valid slugs" } };

  const correctPrefix = cfg.blogPath[articleLang] ?? cfg.blogPath.default ?? "/blog";

  let fixed = 0, kept = 0, replaced = 0;
  let rrIdx = 0; // round-robin

  const newContent = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, anchor, href) => {
    // Skip external links
    if (/^https?:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#")) {
      return full;
    }
    // Skip anchor-only
    if (!href.startsWith("/")) return full;

    // Extract last slug segment
    const parts = href.split("/").filter(Boolean);
    const linkSlug = parts[parts.length - 1];

    // Only process blog-like links
    const looksLikeBlog = /blog|produit|product|posts/i.test(href) || parts.length >= 1;
    if (!looksLikeBlog) return full;

    // Check if slug exists in repo
    if (validSlugs.includes(linkSlug)) {
      // Valid slug — ensure correct prefix
      const newHref = `${correctPrefix}/${linkSlug}`;
      if (newHref !== href) { fixed++; return `[${anchor}](${newHref})`; }
      kept++;
      return full;
    }

    // Slug doesn't exist → replace with a valid one (round-robin)
    const replacement = validSlugs[rrIdx % validSlugs.length];
    rrIdx++;
    replaced++;
    return `[${anchor}](${correctPrefix}/${replacement})`;
  });

  return { content: newContent, stats: { fixed, kept, replaced } };
}

async function getFile(repo, filePath, branches) {
  for (const branch of branches) {
    if (!branch) continue;
    const res = await gh(`/repos/${repo}/contents/${filePath}?ref=${branch}`);
    if (!res.ok) continue;
    const data = await res.json();
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return { content, sha: data.sha, branch };
  }
  return null;
}

async function putFile(repo, filePath, branch, content, sha, message) {
  const res = await gh(`/repos/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      sha,
      branch,
    }),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? null : await res.text() };
}

async function main() {
  const runAll = process.argv.includes("--all");
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    runAll
      ? "Loading all published articles..."
      : "Loading today's published articles..."
  );

  const rows = runAll
    ? await sql`
      SELECT ar.id, ar.keyword, ar.github_url, s.name as site
      FROM autopilot_runs ar
      JOIN sites s ON s.id = ar.site_id
      WHERE ar.status = 'published'
        AND ar.github_url IS NOT NULL
      ORDER BY s.name, ar.created_at DESC
    `
    : await sql`
      SELECT ar.id, ar.keyword, ar.github_url, s.name as site
      FROM autopilot_runs ar
      JOIN sites s ON s.id = ar.site_id
      WHERE ar.created_at >= CURRENT_DATE
        AND ar.status = 'published'
        AND ar.github_url IS NOT NULL
      ORDER BY s.name, ar.created_at DESC
    `;

  console.log(
    `Found ${rows.length} articles.${dryRun ? " (dry-run mode)" : ""}\n`
  );

  const results = { fixed: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    const parsed = parseGhUrl(row.github_url);
    if (!parsed) { console.log(`  ❌ ${row.site} — bad URL`); results.errors++; continue; }

    const cfg = SITE_CONFIG[parsed.repo];
    if (!cfg) { console.log(`  ⚠️  ${parsed.repo} — no config`); results.skipped++; continue; }

    // Prime slug cache
    await listRepoSlugs(parsed.repo, cfg.articlePath);

    // Load current content (with fallback path if github_url is stale)
    const cache = slugCache.get(`${parsed.repo}|${cfg.articlePath}`);
    const candidateBranches = [parsed.branch, cache?.branch, "master", "main"];
    let filePath = parsed.filePath;
    let file = await getFile(parsed.repo, filePath, candidateBranches);
    if (!file && cfg.articlePath) {
      const altPath = `${cfg.articlePath}/${parsed.filename}`;
      if (altPath !== filePath) {
        const alt = await getFile(parsed.repo, altPath, candidateBranches);
        if (alt) {
          file = alt;
          filePath = altPath;
          console.log(`  ℹ️  ${row.site}/${parsed.slug} — used fallback path ${altPath}`);
        }
      }
    }
    if (!file && cfg.articlePath) {
      for (const ext of ["mdx", "md"]) {
        const altPath = `${cfg.articlePath}/${parsed.slug}.${ext}`;
        if (altPath === filePath) continue;
        const alt = await getFile(parsed.repo, altPath, candidateBranches);
        if (alt) {
          file = alt;
          filePath = altPath;
          console.log(`  ℹ️  ${row.site}/${parsed.slug} — used fallback path ${altPath}`);
          break;
        }
      }
    }
    if (!file) { console.log(`  ❌ ${row.site}/${parsed.slug} — fetch failed`); results.errors++; continue; }

    const articleLang = detectLang(parsed.slug);
    const { content: fixedContent, stats } = fixLinks(file.content, {
      repo: parsed.repo,
      selfSlug: parsed.slug,
      articleLang,
    });

    if (stats.skipped) {
      console.log(`  ⚠️  ${row.site}/${parsed.slug} — skipped (${stats.reason || "?"})`);
      results.skipped++;
      continue;
    }

    const totalChanges = (stats.fixed || 0) + (stats.replaced || 0);
    if (totalChanges === 0) {
      console.log(`  ✅ ${row.site}/${parsed.slug} — already correct (${stats.kept} links OK)`);
      continue;
    }

    if (dryRun) {
      console.log(
        `  🧪 ${row.site}/${parsed.slug} — would fix ${stats.fixed} prefix, replace ${stats.replaced} broken, keep ${stats.kept}`
      );
      results.fixed++;
      continue;
    }

    // Push fix
    const put = await putFile(
      parsed.repo,
      filePath,
      file.branch,
      fixedContent,
      file.sha,
      `fix: correct internal links in ${parsed.slug}`
    );

    if (put.ok) {
      console.log(`  🔧 ${row.site}/${parsed.slug} — fixed ${stats.fixed} prefix, replaced ${stats.replaced} broken, kept ${stats.kept}`);
      results.fixed++;
    } else {
      console.log(`  ❌ ${row.site}/${parsed.slug} — PUT ${put.status}: ${put.body?.slice(0, 100)}`);
      results.errors++;
    }
  }

  console.log(
    `\nDone. ${dryRun ? "Would fix" : "Fixed"}: ${results.fixed}, skipped: ${results.skipped}, errors: ${results.errors}`
  );
}

main().catch(e => { console.error(e); process.exit(1); });
