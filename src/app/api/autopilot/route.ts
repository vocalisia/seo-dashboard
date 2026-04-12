export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL, initDB } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { generateImage } from "@/lib/ai";
import { publishToGitHub, listRepoFiles } from "@/lib/github";

// Site → GitHub repo mapping
const SITE_REPO_MAP: Record<
  string,
  { repo: string; articlePath: string; format: string }
> = {
  "vocalis-blog": {
    repo: "vocalisia/vocalis-blog",
    articlePath: "content/blog",
    format: "mdx",
  },
  "vocalis-pro": {
    repo: "vocalisia/vocalis-blog",
    articlePath: "content/blog",
    format: "mdx",
  },
  "tesla-mag": {
    repo: "vocalisia/tesla-mag",
    articlePath: "src/data/articles",
    format: "mdx",
  },
  "trust-vault": {
    repo: "vocalisia/trust-vault",
    articlePath: "content/posts",
    format: "mdx",
  },
  "trustly": {
    repo: "vocalisia/trust-ai-blog",
    articlePath: "content/blog",
    format: "mdx",
  },
  iapmesuisse: {
    repo: "vocalisia/iapmesuisse",
    articlePath: "content/blog",
    format: "mdx",
  },
  "hub-ai": {
    repo: "vocalisia/hub-ai",
    articlePath: "content/blog",
    format: "mdx",
  },
  "ai-due": {
    repo: "vocalisia/hub-ai",
    articlePath: "content/blog",
    format: "mdx",
  },
  "vocalis-ai": {
    repo: "vocalisia/vocalis-ai",
    articlePath: "content/blog",
    format: "mdx",
  },
  "cbd": {
    repo: "vocalisia/cbd-europa",
    articlePath: "content/blog",
    format: "mdx",
  },
  "agents-ia": {
    repo: "vocalisia/agents-ia-pro",
    articlePath: "content/blog",
    format: "mdx",
  },
  "master-seller": {
    repo: "vocalisia/master-seller",
    articlePath: "content/blog",
    format: "mdx",
  },
  "whatsapp": {
    repo: "vocalisia/agent-whatsapp-ia-business",
    articlePath: "content/blog",
    format: "mdx",
  },
  "lead-gene": {
    repo: "vocalisia/geoleads",
    articlePath: "content/blog",
    format: "mdx",
  },
  "seo-true": {
    repo: "vocalisia/seo-true",
    articlePath: "content/blog",
    format: "mdx",
  },
  "woman-cute": {
    repo: "vocalisia/woman-cute",
    articlePath: "content/blog",
    format: "mdx",
  },
};

// Language config: label, locale, instructions language, target countries (ISO-3)
const LANG_CONFIG: Record<string, {
  label: string;
  locale: string;
  serpLang: string;
  articleLang: string;
  countries: string[];
}> = {
  fr: { label: "Français",   locale: "fr-FR", serpLang: "French",     articleLang: "français",   countries: ["FRA","BEL","CHE","LUX","MCO","CAN"] },
  en: { label: "English",    locale: "en-US", serpLang: "English",    articleLang: "English",    countries: ["GBR","USA","IRL","AUS","NZL","CAN"] },
  de: { label: "Deutsch",    locale: "de-DE", serpLang: "German",     articleLang: "Deutsch",    countries: ["DEU","AUT","CHE","LIE"] },
  es: { label: "Español",    locale: "es-ES", serpLang: "Spanish",    articleLang: "español",    countries: ["ESP","MEX","ARG","COL","CHL","PER"] },
  it: { label: "Italiano",   locale: "it-IT", serpLang: "Italian",    articleLang: "italiano",   countries: ["ITA","CHE","SMR","VAT"] },
  nl: { label: "Nederlands", locale: "nl-NL", serpLang: "Dutch",      articleLang: "Nederlands", countries: ["NLD","BEL"] },
  pt: { label: "Português",  locale: "pt-PT", serpLang: "Portuguese", articleLang: "português",  countries: ["PRT","BRA","AGO","MOZ"] },
};

interface Site {
  id: number;
  name: string;
  url: string;
  gsc_property: string;
}

interface KeywordRow {
  query: string;
  position: string;
  impressions: string;
  clicks: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export async function POST(req: NextRequest) {
  let body: { site_id?: number; dry_run?: boolean; language?: string };
  try {
    body = (await req.json()) as { site_id?: number; dry_run?: boolean; language?: string };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { site_id, dry_run = false, language = "fr" } = body;
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
    // 1. Get site
    const siteRows = (await sql`SELECT * FROM sites WHERE id = ${site_id} LIMIT 1`) as Site[];
    if (siteRows.length === 0) {
      return NextResponse.json({ success: false, error: "Site not found" }, { status: 404 });
    }
    const site = siteRows[0];

    // Find repo config by matching site name — normalize dashes/spaces/case
    const normalizedSiteName = site.name.toLowerCase().replace(/[\s_]+/g, "-");
    const siteKey = Object.keys(SITE_REPO_MAP).find((k) => {
      const normK = k.toLowerCase();
      return normalizedSiteName.includes(normK) || normK.includes(normalizedSiteName);
    });
    const repoConfig = siteKey ? SITE_REPO_MAP[siteKey] : null;
    console.log(`[autopilot] site="${site.name}" → normalized="${normalizedSiteName}" → siteKey=${siteKey ?? "null"}`);

    // 2. Get top keyword opportunity FILTERED BY COUNTRY of the target language
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
    console.log(`[autopilot] dry_run=${dry_run} usedKeywords=${usedKeywords.length}`);

    // Step A: country-filtered query (requires country data synced)
    let kwRows = (await sql`
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
      LIMIT 1
    `) as KeywordRow[];
    console.log(`[autopilot] step A (country-filtered): ${kwRows.length} rows`);

    // Fallback 1: no country data → use all data, same position range
    if (kwRows.length === 0) {
      kwRows = (await sql`
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
        LIMIT 1
      `) as KeywordRow[];
      console.log(`[autopilot] step B (all countries, pos 3-50): ${kwRows.length} rows`);
    }

    // Fallback 2: ultra relaxed — any keyword with any impression, any position
    if (kwRows.length === 0) {
      kwRows = (await sql`
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
        LIMIT 1
      `) as KeywordRow[];
      console.log(`[autopilot] step C (ultra relaxed, 90d): ${kwRows.length} rows`);
    }

    if (kwRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: `No keyword found for ${lang.label}. Lance une synchro GSC d'abord (dashboard → Synchroniser).`,
      });
    }

    const { query: keyword, position, impressions } = kwRows[0];

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
        console.log(`[autopilot] fetched ${existingArticles.length} articles from ${repoConfig.repo}/${repoConfig.articlePath}`);
      } catch (err) {
        console.error("Failed to list repo files:", err);
      }
    } else {
      console.warn(`[autopilot] no repoConfig for site "${site.name}" → no internal linking available`);
    }

    // Pick up to 15 existing articles for internal linking — remove .mdx extension for slugs
    const linkCandidates = existingArticles
      .slice(0, 15)
      .map(f => f.replace(/\.mdx?$/, ""));
    console.log(`[autopilot] linkCandidates (${linkCandidates.length}):`, linkCandidates.slice(0, 5));

    // 5. Generate article via Claude Sonnet (in target language)
    const today = todayISO();
    const articleSlug = slugify(keyword);

    let articleContent = "";
    let articleTitle = keyword;
    const linkStats = { total: 0, valid: 0, fuzzy: 0, roundRobin: 0, skipped: 0 };

    try {
      const serpContext = serpAnalysis.slice(0, 800);

      // Build explicit internal link instructions with real slugs
      const blogPrefix = "/blog";
      const internalLinksBlock = linkCandidates.length > 0
        ? `## MANDATORY INTERNAL LINKING — STRICT RULES
You MUST integrate 4 to 6 internal links in the body of the article.

⚠️ CRITICAL: You can ONLY use slugs from the EXACT list below. NEVER invent, guess, or modify slugs.
⚠️ If you hallucinate a slug not in this list, the article will be REJECTED.
⚠️ ALWAYS prefix links with "${blogPrefix}/". No exceptions.

ALLOWED SLUGS (copy EXACTLY as shown, do not translate or modify):
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

## Schema JSON-LD (MANDATORY — copy EXACTLY after the conclusion)
At the very end of the article, add this FAQ schema block. Replace Q1/A1/Q2/A2/Q3/A3 with the EXACT questions and answers from the FAQ section above:

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Q1", "acceptedAnswer": {"@type": "Answer", "text": "A1"}},
    {"@type": "Question", "name": "Q2", "acceptedAnswer": {"@type": "Answer", "text": "A2"}},
    {"@type": "Question", "name": "Q3", "acceptedAnswer": {"@type": "Answer", "text": "A3"}}
  ]
}
</script>

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

      // VALIDATE INTERNAL LINKS — replace any hallucinated slug with a real one from linkCandidates
      if (linkCandidates.length > 0) {
        const validSlugs = new Set(linkCandidates.map((s) => s.toLowerCase()));
        // Match [anchor](/blog/slug) or [anchor](/slug) — only internal relative links
        const internalLinkRegex = /\[([^\]]+)\]\((\/(?!\/)[^)]+)\)/g;
        let replacementIndex = 0;

        articleContent = articleContent.replace(internalLinkRegex, (_match, anchor: string, url: string) => {
          linkStats.total++;

          // Normalize: strip leading /, /blog/, trailing slash
          const normalized = url
            .replace(/^\/(?:blog\/)?/, "")
            .replace(/\/$/, "")
            .toLowerCase();

          // Already valid → ensure /blog/ prefix
          if (validSlugs.has(normalized)) {
            linkStats.valid++;
            return `[${anchor}](/blog/${normalized})`;
          }

          // Try fuzzy match: find a slug containing significant words from the invalid path
          const words = normalized.split("-").filter((w) => w.length > 3);
          const fuzzyMatch = linkCandidates.find((slug) =>
            words.some((w) => slug.toLowerCase().includes(w))
          );
          if (fuzzyMatch) {
            linkStats.fuzzy++;
            return `[${anchor}](/blog/${fuzzyMatch})`;
          }

          // Last resort: round-robin through linkCandidates to diversify
          const replacement = linkCandidates[replacementIndex % linkCandidates.length];
          replacementIndex++;
          linkStats.roundRobin++;
          return `[${anchor}](/blog/${replacement})`;
        });
      } else {
        linkStats.skipped = 1;
      }
      console.log(`[autopilot] link validation:`, linkStats);

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

      console.log(`[autopilot] image prompt: ${imagePrompt.slice(0, 200)}...`);
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
      // Add language prefix to filename if not French
      const langPrefix = language !== "fr" ? `${language}-` : "";
      const filePath = `${repoConfig.articlePath}/${langPrefix}${articleSlug}-${today}.mdx`;
      const commitMsg = `feat: add ${lang.label} SEO article "${keyword}" via autopilot`;

      try {
        githubUrl = await publishToGitHub(
          repoConfig.repo,
          filePath,
          articleContent,
          commitMsg
        );
      } catch (err) {
        console.error("GitHub publish failed:", err);
      }
    }

    // 8. Store result in autopilot_runs (with language)
    const runStatus = dry_run ? "dry_run" : githubUrl ? "published" : "failed";
    try {
      await sql`
        INSERT INTO autopilot_runs (site_id, keyword, article_title, github_url, image_url, status, language)
        VALUES (${site_id}, ${keyword}, ${articleTitle}, ${githubUrl ?? null}, ${imageUrl ?? null}, ${runStatus}, ${language})
        ON CONFLICT DO NOTHING
      `.catch(() =>
        // Fallback if language column doesn't exist yet
        sql`
          INSERT INTO autopilot_runs (site_id, keyword, article_title, github_url, image_url, status)
          VALUES (${site_id}, ${keyword}, ${articleTitle}, ${githubUrl ?? null}, ${imageUrl ?? null}, ${runStatus})
        `
      );
    } catch (err) {
      console.error("Failed to store autopilot run:", err);
    }

    // 9. Return result
    return NextResponse.json({
      success: true,
      keyword,
      language,
      position: parseFloat(position),
      impressions: parseInt(impressions),
      article_title: articleTitle,
      article_preview: articleContent,
      github_url: githubUrl,
      image_url: imageUrl,
      dry_run,
      status: runStatus,
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
