export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { publishToGitHub } from "@/lib/github";
import { requireApiSession } from "@/lib/api-auth";

/**
 * POST /api/opportunities/deploy
 * body: { opportunity_id: number, domain: string }
 *
 * Auto-creates a new site:
 * 1. Create GitHub repo
 * 2. Init with content/blog/ + README
 * 3. Add site to DB (sites table)
 * 4. Add to SITE_REPO_MAP (logged for manual update)
 * 5. Seed first articles via autopilot
 * 6. Mark opportunity as "deployed"
 */
export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  let body: { opportunity_id?: number; domain?: string };
  try {
    body = (await req.json()) as { opportunity_id?: number; domain?: string };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { opportunity_id, domain } = body;
  if (!opportunity_id || !domain) {
    return NextResponse.json({ success: false, error: "opportunity_id and domain required" }, { status: 400 });
  }

  const sql = getSQL();
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ success: false, error: "GITHUB_TOKEN not configured" }, { status: 500 });
  }

  try {
    // 1. Get opportunity from DB
    const rows = await sql`SELECT * FROM market_opportunities WHERE id = ${opportunity_id} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
    }
    const opp = rows[0];

    // Slugify domain for repo name
    const repoName = (domain as string)
      .replace(/\.(com|ch|fr|org|io|pro|blog|ai)$/i, "")
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase();

    // 2. Create GitHub repo
    const createRes = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        name: repoName,
        private: false,
        auto_init: true,
        description: `${opp.niche} — Auto-generated SEO site via dashboard`,
      }),
    });

    let repoFullName = repoName;
    if (createRes.ok) {
      const repoData = (await createRes.json()) as { full_name: string };
      repoFullName = repoData.full_name;
    } else if (createRes.status === 422) {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!userRes.ok) {
        return NextResponse.json({ success: false, error: "Impossible de déterminer le compte GitHub" }, { status: 502 });
      }
      const userData = (await userRes.json()) as { login?: string };
      if (!userData.login) {
        return NextResponse.json({ success: false, error: "Compte GitHub invalide" }, { status: 502 });
      }
      repoFullName = `${userData.login}/${repoName}`;
    } else {
      const err = await createRes.text();
      console.error("Repo creation failed:", err);
      return NextResponse.json({ success: false, error: "La création du repo GitHub a échoué" }, { status: 502 });
    }

    // 3. Init content/blog directory
    try {
      const readmeContent = `# ${opp.niche}\n\nSEO site auto-generated.\nDomain: ${domain}\nType: ${opp.site_type}\nMonetization: ${opp.monetization}`;
      await publishToGitHub(
        repoFullName,
        "content/blog/.gitkeep",
        readmeContent,
        "init: setup blog directory for SEO autopilot"
      );
    } catch (err) {
      console.error("Initial GitHub content publish failed:", err);
      return NextResponse.json({ success: false, error: "Le repo GitHub existe mais l'initialisation a échoué" }, { status: 502 });
    }

    // 4. Add site to DB
    const siteName = (opp.niche as string).slice(0, 100);
    const siteUrl = `https://${domain}`;

    const existingSite = await sql`SELECT id FROM sites WHERE url = ${siteUrl} LIMIT 1`;
    let siteId: number;

    if (existingSite.length > 0) {
      siteId = existingSite[0].id as number;
    } else {
      const newSite = await sql`
        INSERT INTO sites (name, url, is_active, target_languages)
        VALUES (${siteName}, ${siteUrl}, true, ARRAY['fr', 'en'])
        RETURNING id
      `;
      siteId = newSite[0].id as number;
    }

    // 5. Mark opportunity as deployed
    await sql`
      UPDATE market_opportunities
      SET status = 'deployed'
      WHERE id = ${opportunity_id}
    `;

    // 6. Log repo mapping (needs manual addition to SITE_REPO_MAP)
    console.log(`[deploy] NEW SITE CREATED:
      Repo: ${repoFullName}
      Site: ${siteName} (${siteUrl})
      Site ID: ${siteId}
      Repo name for SITE_REPO_MAP: "${repoName}": { repo: "${repoFullName}", articlePath: "content/blog", format: "mdx" }
    `);

    return NextResponse.json({
      success: true,
      site_id: siteId,
      repo: repoFullName,
      domain,
      niche: opp.niche,
      seed_articles: opp.seed_articles,
      message: `Site créé: ${repoFullName} → ${siteUrl}. Ajoute le domaine sur Vercel et connecte-le au repo.`,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
