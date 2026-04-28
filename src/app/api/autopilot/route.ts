export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL, initDB } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { generateImage } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";
import { hasValidCronSecret } from "@/lib/cron-auth";
import { publishToGitHub, listRepoFiles } from "@/lib/github";
import { getGoogleAuth } from "@/lib/google-auth";
import type { KeywordRow } from "@/lib/autopilot-keywords";
import { pickFirstUsableKeyword } from "@/lib/autopilot-keywords";
import { LANG_CONFIG, resolveSiteRepoConfig } from "@/lib/autopilot-config";
import { logAutopilot } from "@/lib/autopilot-log";
import {
  blogPathForLocale,
  buildPublishedArticleUrl,
  normalizeAutopilotMarkdownLinks,
} from "@/lib/autopilot-published-url";
import { slugify, todayISO } from "@/lib/autopilot-utils";

interface Site {
  id: number;
  name: string;
  url: string;
  gsc_property: string;
}

export async function POST(req: NextRequest) {
  const cronAuthorized = hasValidCronSecret(req);
  if (!cronAuthorized) {
    const authState = await requireApiSession();
    if (authState.unauthorized) {
      return authState.unauthorized;
    }
  }

  let body: { site_id?: number; dry_run?: boolean; language?: string; source?: "gsc" | "competitor" };
  try {
    body = (await req.json()) as { site_id?: number; dry_run?: boolean; language?: string; source?: "gsc" | "competitor" };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { site_id, dry_run = false, language = "fr", source = "gsc" } = body;
  const lang = LANG_CONFIG[language] ?? LANG_CONFIG.fr;

  if (!site_id || typeof site_id !== "number") {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();

  // Ensure all tables exist (idempotent — creates autopilot_runs if missing)
  try {
    await initDB();
  } catch (err) {
    console.error("initDB failed:", err);
  }

  try {
    logAutopilot("run_start", { site_id, dry_run, language, source });

    // 1. Get site
    const siteRows = (await sql`SELECT * FROM sites WHERE id = ${site_id} LIMIT 1`) as Site[];
    if (siteRows.length === 0) {
      logAutopilot("site_not_found", { site_id });
      return NextResponse.json({ success: false, error: "Site not found" }, { status: 404 });
    }
    const site = siteRows[0];

    const { normalizedSiteName, siteKey, repoConfig } = resolveSiteRepoConfig(site.name);
    logAutopilot("site_repo_resolved", {
      siteName: site.name,
      normalizedSiteName,
      siteKey,
      repo: repoConfig?.repo ?? null,
      enabled: repoConfig?.enabled !== false,
    });

    // Garde-fou : si le repo est marqué disabled, on n'écrit rien — sinon
    // on génère des fichiers MDX dans un repo qui n'est pas la source de
    // déploiement et on fabrique des URLs 404 publiques.
    if (repoConfig && repoConfig.enabled === false) {
      logAutopilot("publication_disabled", {
        site_id,
        siteName: site.name,
        siteKey,
        reason: repoConfig.disabledReason ?? "publication désactivée",
      });
      return NextResponse.json(
        {
          success: false,
          error: `Publication désactivée pour ${site.name} : ${repoConfig.disabledReason ?? "site sans pipeline MDX déployé."}`,
          disabled: true,
          site_name: site.name,
          repo: repoConfig.repo,
        },
        { status: 422 }
      );
    }

    // 2. Get top keyword opportunity
    //    source="gsc" → from GSC data (improve existing rankings)
    //    source="competitor" → from competitor_research gaps (attack new terrain)
    const targetCountries = lang.countries;

    // Fetch already-used keywords for this site+language (skip if table missing)
    // For dry_run, do NOT exclude — tests must be reproducible
    let usedKeywords: string[] = [];
    if (!dry_run) {
      try {
        const usedRows = (await sql`
          SELECT LOWER(keyword) AS keyword
          FROM autopilot_runs
          WHERE site_id = ${site_id}
            AND COALESCE(language, 'fr') = ${language}
            AND status = 'published'
        `) as { keyword: string }[];
        usedKeywords = usedRows.map((r) => r.keyword);
      } catch (err) {
        console.error("Failed to fetch used keywords (table may not exist yet):", err);
      }
    }
    logAutopilot("used_keywords_loaded", {
      dry_run,
      source,
      usedKeywordCount: usedKeywords.length,
    });

    let kwRows: KeywordRow[] = [];

    // If source=competitor, go DIRECTLY to competitor gaps (skip GSC entirely)
    if (source === "competitor") {
      try {
        const gapRows = (await sql`
          SELECT keyword AS query,
                 competitor_position AS position,
                 estimated_volume AS impressions,
                 0 AS clicks
          FROM competitor_research
          WHERE site_id = ${site_id}
            AND estimated_volume >= 1000
            AND NOT (LOWER(keyword) = ANY(${usedKeywords}))
          ORDER BY estimated_volume DESC
          LIMIT 80
        `) as KeywordRow[];
        const usableGap = pickFirstUsableKeyword(gapRows, site, language);
        if (usableGap.length > 0) {
          kwRows = usableGap;
          logAutopilot("keyword_from_competitor_primary", {
            query: kwRows[0].query,
            volume: kwRows[0].impressions,
          });
        }
      } catch {
        // competitor_research table may not exist
      }

      if (kwRows.length === 0) {
        logAutopilot("no_keyword_competitor_only", { site_id, siteName: site.name });
        return NextResponse.json({
          success: false,
          error: `No competitor gap found for ${site.name}. Lance l'analyse concurrents d'abord (/competitors).`,
        });
      }
    }

    // GSC keyword search — only if source=gsc (skip for competitor mode)
    if (source !== "competitor") {

    // Step A: country-filtered query (requires country data synced)
    // Fetch top N by impressions, then pick first that passes quality filters (not site:, URLs, pure brand…)
    const rawA = (await sql`
      SELECT query,
             AVG(position)    AS position,
             SUM(impressions) AS impressions,
             SUM(clicks)      AS clicks
      FROM search_console_data
      WHERE site_id = ${site_id}
        AND country = ANY(${targetCountries})
        AND date >= NOW() - INTERVAL '30 days'
        AND impressions >= 2
        AND NOT (LOWER(query) = ANY(${usedKeywords}))
      GROUP BY query
      HAVING AVG(position) BETWEEN 3 AND 50
      ORDER BY SUM(impressions) DESC
      LIMIT 100
    `) as KeywordRow[];
    kwRows = pickFirstUsableKeyword(rawA, site, language);
    logAutopilot("gsc_step", { step: "A_country", rawCount: rawA.length, usableCount: kwRows.length });

    // Fallback 1: no country data → use all data, same position range
    if (kwRows.length === 0) {
      const rawB = (await sql`
        SELECT query,
               AVG(position)    AS position,
               SUM(impressions) AS impressions,
               SUM(clicks)      AS clicks
        FROM search_console_data
        WHERE site_id = ${site_id}
          AND date >= NOW() - INTERVAL '30 days'
          AND impressions >= 2
          AND NOT (LOWER(query) = ANY(${usedKeywords}))
        GROUP BY query
        HAVING AVG(position) BETWEEN 3 AND 50
        ORDER BY SUM(impressions) DESC
        LIMIT 100
      `) as KeywordRow[];
      kwRows = pickFirstUsableKeyword(rawB, site, language);
      logAutopilot("gsc_step", { step: "B_all_countries", rawCount: rawB.length, usableCount: kwRows.length });
    }

    // Fallback 2: ultra relaxed — any keyword with any impression, any position
    if (kwRows.length === 0) {
      const rawC = (await sql`
        SELECT query,
               AVG(position)    AS position,
               SUM(impressions) AS impressions,
               SUM(clicks)      AS clicks
        FROM search_console_data
        WHERE site_id = ${site_id}
          AND date >= NOW() - INTERVAL '90 days'
          AND impressions >= 1
          AND NOT (LOWER(query) = ANY(${usedKeywords}))
        GROUP BY query
        ORDER BY SUM(impressions) DESC
        LIMIT 100
      `) as KeywordRow[];
      kwRows = pickFirstUsableKeyword(rawC, site, language);
      logAutopilot("gsc_step", { step: "C_relaxed_90d", rawCount: rawC.length, usableCount: kwRows.length });
    }

    } // end of source !== "competitor" block

    // Fallback 3: use competitor research gaps (high volume keywords we don't rank for)
    if (kwRows.length === 0) {
      try {
        const gapRowsD = (await sql`
          SELECT keyword AS query,
                 competitor_position AS position,
                 estimated_volume AS impressions,
                 0 AS clicks
          FROM competitor_research
          WHERE site_id = ${site_id}
            AND estimated_volume >= 1000
            AND NOT (LOWER(keyword) = ANY(${usedKeywords}))
          ORDER BY estimated_volume DESC
          LIMIT 80
        `) as KeywordRow[];
        const usableD = pickFirstUsableKeyword(gapRowsD, site, language);
        if (usableD.length > 0) {
          kwRows = usableD;
          logAutopilot("keyword_from_competitor_fallback", {
            query: kwRows[0].query,
            volume: kwRows[0].impressions,
          });
        }
      } catch {
        // competitor_research table may not exist yet
      }
    }

    if (kwRows.length === 0) {
      logAutopilot("no_keyword_after_all_steps", { site_id, language, source });
      return NextResponse.json({
        success: false,
        error: `No keyword found for ${lang.label}. Lance une synchro GSC ou une analyse concurrents d'abord.`,
      });
    }

    const { query: keyword, position, impressions } = kwRows[0];
    logAutopilot("keyword_selected", {
      keyword,
      position: parseFloat(String(position)),
      impressions: parseInt(String(impressions), 10),
      language,
      source,
    });

    // 3. SERP analysis via Perplexity (in target language)
    let serpAnalysis = "";
    try {
      serpAnalysis = await askAI(
        [
          {
            role: "user",
            content: `Analyse the top Google results for the keyword "${keyword}" in ${lang.serpLang}.
Identify: 1) Main search intent 2) Topics covered by top results 3) Content gaps 4) Recommended H2/H3 structure 5) Frequent FAQ questions.
Reply in JSON with keys: intent, topics, gaps, structure, faqs`,
          },
        ],
        "search",
        1000
      );
    } catch (err) {
      console.error("SERP analysis failed:", err);
      serpAnalysis = `Keyword: ${keyword}, avg position: ${position}, impressions: ${impressions}`;
    }

    // 4. Get existing articles from GitHub for internal linking
    let existingArticles: string[] = [];
    if (repoConfig) {
      try {
        existingArticles = await listRepoFiles(repoConfig.repo, repoConfig.articlePath);
        logAutopilot("github_articles_listed", {
          repo: repoConfig.repo,
          path: repoConfig.articlePath,
          count: existingArticles.length,
        });
      } catch (err) {
        console.error("Failed to list repo files:", err);
      }
    } else {
      logAutopilot("no_repo_config", { siteName: site.name, hint: "internal_linking_disabled" });
    }

    // Pick up to 15 existing articles for internal linking — remove .mdx extension for slugs
    const linkCandidates = existingArticles
      .slice(0, 15)
      .map(f => f.replace(/\.mdx?$/, ""));
    logAutopilot("link_candidates", { count: linkCandidates.length, sample: linkCandidates.slice(0, 5) });

    // 5. Generate article via Claude Sonnet (in target language)
    const today = todayISO();
    const articleSlug = slugify(keyword);
    // Language prefix for filenames/slugs (empty for French, else "en-", "de-", etc.)
    // Defined here so it's available in both the article prompt and GitHub publish step
    const langPrefix = (!repoConfig?.i18nBlogPath && language !== "fr") ? `${language}-` : "";

    let articleContent = "";
    let articleTitle = keyword;
    const linkStats = { total: 0, valid: 0, fuzzy: 0, roundRobin: 0, skipped: 0 };

    try {
      const serpContext = serpAnalysis.slice(0, 800);

      // Même préfixe que l’URL publique (ex. /fr/blog sur Lead-Gene), pas /blog seul.
      const blogPrefix = blogPathForLocale(repoConfig, language);
      const internalLinksBlock = linkCandidates.length > 0
        ? `## MANDATORY INTERNAL LINKING — STRICT RULES
You MUST integrate 4 to 6 internal links in the body of the article.

⚠️ CRITICAL: You can ONLY use slugs from the EXACT list below. NEVER invent, guess, or modify slugs.
⚠️ If you hallucinate a slug not in this list, the article will be REJECTED.
⚠️ ALWAYS use paths exactly like "${blogPrefix}/<slug>" (full path prefix below). NEVER use only "/blog/" unless it appears in the list exactly like that.

ALLOWED URL PATHS (copy EXACTLY — slug includes the date suffix as shown):
${linkCandidates.map((s, i) => `  ${i + 1}. ${blogPrefix}/${s}`).join("\n")}

Link format: [optimized anchor](${blogPrefix}/EXACT-slug-from-list-above)

CORRECT ANCHOR EXAMPLES (anchors must be keyword-rich, NEVER "click here" / "read more" / "learn more"):
- [vocal AI agent for businesses](${blogPrefix}/${linkCandidates[0] ?? "example-slug"})
- [optimize speech recognition](${blogPrefix}/${linkCandidates[1] ?? "another-slug"})

Pick the 4-6 slugs from the list that are MOST SEMANTICALLY RELEVANT to "${keyword}".
Anchors must contain variations of "${keyword}" or semantically close terms, in the article language.`
        : "";

      const langInstruction = `You are a senior SEO expert. Write complete MDX articles in ${lang.articleLang} with mandatory internal linking. Generate ONLY raw MDX content, no markdown code block wrappers.`;

      articleContent = await askAI(
        [
          {
            role: "system",
            content: langInstruction,
          },
          {
            role: "user",
            content: `Write a ${lang.articleLang} SEO article of 1300-1600 words for the main keyword: "${keyword}"
Language: ${lang.articleLang} (IMPORTANT: the entire article must be written in ${lang.articleLang})

SERP CONTEXT: ${serpContext}

${internalLinksBlock}

REQUIRED STRUCTURE:
---
title: "H1 SEO-optimized in ${lang.articleLang}, 50-65 chars. Rules: (1) MUST contain '${keyword}' naturally (2) MUST reflect the actual article angle you develop below (3) include a benefit, year, or specific number to boost CTR. Example format: '[Keyword]: [Specific Benefit] for [Audience] in 2026'. NEVER write a generic 'The Ultimate Guide' style title if the content is not a guide."
description: "Meta description 145-160 chars in ${lang.articleLang}. MUST contain '${keyword}' and summarize the SPECIFIC angle of the article (not generic). Include a call-to-action verb."
date: "${today}"
tags: ["${keyword.split(" ")[0]}", "tag2", "tag3", "tag4"]
slug: "${langPrefix}${articleSlug}-${today}"
image: "/placeholder.jpg"
author: "SEO Autopilot"
lang: "${language}"
---

## Introduction (hook + ${keyword} in first sentence, in ${lang.articleLang})

## [H2 title with secondary keyword, in ${lang.articleLang}]
[content + 1-2 internal links here]

## [H2 title, in ${lang.articleLang}]
[content + 1-2 internal links here]

## [H2 title, in ${lang.articleLang}]
[content + 1 internal link here]

## [H2 title, in ${lang.articleLang}]
[content]

## FAQ — Frequently Asked Questions about ${keyword}
**Q: [question 1 in ${lang.articleLang}]?**
A: [answer 1 in ${lang.articleLang}]

**Q: [question 2 in ${lang.articleLang}]?**
A: [answer 2 in ${lang.articleLang}]

**Q: [question 3 in ${lang.articleLang}]?**
A: [answer 3 in ${lang.articleLang}]

## Conclusion
[summary + call to action + 1 internal link, in ${lang.articleLang}]

REMINDER: integrate 4-6 internal links spread throughout the article with anchors containing "${keyword}" or its variants. WRITE THE ENTIRE ARTICLE IN ${lang.articleLang.toUpperCase()}.`,
          },
        ],
        "smart",
        3000
      );

      // Strip markdown code block wrapper if model added one (```mdx ... ```)
      articleContent = articleContent
        .replace(/^```(?:mdx|markdown)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();

      // Strip any <script> tags — they break MDX compilation (JSX treats {} as expressions)
      articleContent = articleContent.replace(/<script[\s\S]*?<\/script>/gi, "").trimEnd();

      // Liens `(fr/blog/...)` sans "/" → chemins relatifs cassés côté navigateur
      articleContent = normalizeAutopilotMarkdownLinks(articleContent, language, repoConfig);

      // VALIDATE INTERNAL LINKS — replace any hallucinated slug with a real one from linkCandidates
      if (linkCandidates.length > 0) {
        const validSlugs = new Set(linkCandidates.map((s) => s.toLowerCase()));
        const blogBase = blogPathForLocale(repoConfig, language).replace(/\/$/, "");
        const blogBaseLower = blogBase.toLowerCase();

        /** Extrait le segment slug (avec date) depuis une URL relative /…/blog/… ou /blog/… */
        const extractSlugFromRelativeUrl = (url: string): string => {
          const path = url.replace(/\/$/, "").toLowerCase();
          if (path.startsWith(blogBaseLower + "/")) {
            return path.slice(blogBaseLower.length + 1);
          }
          // Liens erronés /blog/… (modèle sans locale)
          const legacyBlog = /^\/blog\/(.+)$/i.exec(path);
          if (legacyBlog) return legacyBlog[1];
          // /fr/blog/, /en/blog/, etc. (modèle partiellement correct)
          const localeBlog = /^\/[a-z]{2}\/blog\/(.+)$/i.exec(path);
          if (localeBlog) return localeBlog[1];
          return path.replace(/^\//, "");
        };

        // Tous les liens markdown sauf http(s) / mailto / # — pas seulement ceux qui commencent par "/"
        let replacementIndex = 0;

        articleContent = articleContent.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          (match, anchor: string, rawHref: string) => {
            const href = String(rawHref).trim();
            if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href)) {
              return match;
            }
            if (href.startsWith("#")) return match;

            linkStats.total++;

            const normalized = extractSlugFromRelativeUrl(href);

            const canonicalFor = (slugKey: string) =>
              linkCandidates.find((s) => s.toLowerCase() === slugKey) ?? slugKey;

            // Already valid → enforce correct blog prefix + casing from repo
            if (validSlugs.has(normalized)) {
              linkStats.valid++;
              const slug = canonicalFor(normalized);
              return `[${anchor}](${blogBase}/${slug})`;
            }

            // Try fuzzy match: find a slug containing significant words from the invalid path
            const words = normalized.split("-").filter((w) => w.length > 3);
            const fuzzyMatch = linkCandidates.find((slug) =>
              words.some((w) => slug.toLowerCase().includes(w))
            );
            if (fuzzyMatch) {
              linkStats.fuzzy++;
              return `[${anchor}](${blogBase}/${fuzzyMatch})`;
            }

            // Last resort: round-robin through linkCandidates to diversify
            const replacement = linkCandidates[replacementIndex % linkCandidates.length];
            replacementIndex++;
            linkStats.roundRobin++;
            return `[${anchor}](${blogBase}/${replacement})`;
          }
        );
      } else {
        linkStats.skipped = 1;
      }
      logAutopilot("link_validation", { ...linkStats });

      // Extract title from frontmatter
      const titleMatch = articleContent.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (titleMatch) articleTitle = titleMatch[1];
    } catch (err) {
      console.error("Article generation failed:", err);
      return NextResponse.json({ success: false, error: "Article generation failed" });
    }

    // Extract description from frontmatter (for image context)
    const descMatch = articleContent.match(/^description:\s*["']?(.+?)["']?\s*$/m);
    const articleDescription = descMatch ? descMatch[1] : "";

    // 6. Generate image via DALL-E 3 — context-aware prompt
    // Use article TITLE + DESCRIPTION as context so image matches the actual content,
    // not just the raw keyword. Detect business/industry from description for better visuals.
    let imageUrl: string | null = null;
    try {
      // Build a rich, context-aware prompt in English (DALL-E understands English best)
      const imagePrompt = [
        `Professional editorial photograph illustrating an article titled "${articleTitle}".`,
        articleDescription ? `Article context: ${articleDescription}` : "",
        `Visual theme: ${keyword} — show the actual subject matter, real people or real objects, business context if applicable.`,
        `Style: modern, clean, professional stock photography, high quality, realistic lighting, 16:9 composition.`,
        `Strict rules: NO text, NO letters, NO logos, NO watermarks, NO cartoon style.`,
      ]
        .filter(Boolean)
        .join(" ");

      logAutopilot("image_prompt_preview", { preview: imagePrompt.slice(0, 240) });
      imageUrl = await generateImage(imagePrompt);

      // Inject image URL into frontmatter if we got one
      if (imageUrl && articleContent.includes('image: "/placeholder.jpg"')) {
        articleContent = articleContent.replace(
          'image: "/placeholder.jpg"',
          `image: "${imageUrl}"`
        );
      }
    } catch (err) {
      console.error("Image generation failed:", err);
    }

    // 7. Publish to GitHub (if not dry_run and repo config exists)
    let githubUrl: string | null = null;
    if (!dry_run && repoConfig) {
      const ext = repoConfig.format === "md" ? "md" : "mdx";
      const filePath = `${repoConfig.articlePath}/${langPrefix}${articleSlug}-${today}.${ext}`;
      const commitMsg = `feat: add ${lang.label} SEO article "${keyword}" via autopilot`;

      try {
        githubUrl = await publishToGitHub(
          repoConfig.repo,
          filePath,
          articleContent,
          commitMsg
        );
        logAutopilot("github_publish_ok", { repo: repoConfig.repo, filePath, githubUrl });
      } catch (err) {
        console.error("GitHub publish failed:", err);
        logAutopilot("github_publish_error", { repo: repoConfig.repo, filePath, error: String(err) });
      }
    }

    /** URL publique de l’article (vérifiable dans le navigateur). */
    let publishedUrl: string | null = null;
    if (githubUrl && !dry_run && repoConfig) {
      publishedUrl = buildPublishedArticleUrl(site.url, keyword, language, repoConfig, today);
    }

    // 8. Request Google indexing for the new article
    let indexingRequested = false;
    if (publishedUrl && !dry_run) {
      try {
        logAutopilot("indexing_request_start", { liveUrl: publishedUrl });

        const auth = getGoogleAuth();
        const client = await (auth as { getClient: () => Promise<{ getAccessToken: () => Promise<{ token?: string | null }> }> }).getClient();
        const tokenResponse = await client.getAccessToken();
        const accessToken = tokenResponse.token;

        if (accessToken) {
          const idxRes = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ url: publishedUrl, type: "URL_UPDATED" }),
          });

          if (idxRes.ok) {
            indexingRequested = true;
            logAutopilot("indexing_request_ok", { liveUrl: publishedUrl });
          } else {
            const errText = await idxRes.text();
            console.error(`[autopilot] indexing API error ${idxRes.status}:`, errText);
          }
        } else {
          console.error("[autopilot] could not obtain access token for indexing");
        }
      } catch (err) {
        console.error("[autopilot] indexing request failed (non-blocking):", err);
      }
    }

    // 8b. Ping Google sitemap endpoint
    if (!dry_run && githubUrl) {
      try {
        const sitemapUrl = `${site.url}/sitemap.xml`;
        await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
        logAutopilot("sitemap_ping", { siteUrl: site.url });
      } catch (err) {
        console.error('[autopilot] sitemap ping failed (non-blocking):', err);
      }
    }

    // 9. Store result in autopilot_runs (with language + published URL)
    const runStatus = dry_run ? "dry_run" : githubUrl ? "published" : "failed";
    try {
      try {
        await sql`ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS published_url VARCHAR(1500)`;
      } catch {
        /* ignore */
      }
      try {
        await sql`
          INSERT INTO autopilot_runs (site_id, keyword, article_title, github_url, image_url, status, language, published_url)
          VALUES (${site_id}, ${keyword}, ${articleTitle}, ${githubUrl ?? null}, ${imageUrl ?? null}, ${runStatus}, ${language}, ${publishedUrl})
        `;
      } catch {
        await sql`
          INSERT INTO autopilot_runs (site_id, keyword, article_title, github_url, image_url, status, language)
          VALUES (${site_id}, ${keyword}, ${articleTitle}, ${githubUrl ?? null}, ${imageUrl ?? null}, ${runStatus}, ${language})
        `.catch(() =>
          sql`
            INSERT INTO autopilot_runs (site_id, keyword, article_title, github_url, image_url, status)
            VALUES (${site_id}, ${keyword}, ${articleTitle}, ${githubUrl ?? null}, ${imageUrl ?? null}, ${runStatus})
          `
        );
      }
    } catch (err) {
      console.error("Failed to store autopilot run:", err);
    }

    logAutopilot("run_complete", {
      site_id,
      keyword,
      status: dry_run ? "dry_run" : githubUrl ? "published" : "failed",
      dry_run,
      hasGithubUrl: Boolean(githubUrl),
    });

    // 10. Return result
    return NextResponse.json({
      success: true,
      keyword,
      language,
      position: parseFloat(position),
      impressions: parseInt(impressions),
      article_title: articleTitle,
      article_preview: articleContent,
      github_url: githubUrl,
      published_url: publishedUrl,
      image_url: imageUrl,
      dry_run,
      status: runStatus,
      indexing_requested: indexingRequested,
      // Debug info for UI
      repo_matched: repoConfig ? repoConfig.repo : null,
      link_candidates_count: linkCandidates.length,
      link_stats: linkStats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Autopilot error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
