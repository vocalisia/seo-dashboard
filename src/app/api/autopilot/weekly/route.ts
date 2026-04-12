export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface Site {
  id: number;
  name: string;
  url: string;
  target_languages: string[] | null;
}

interface AutopilotResult {
  site: string;
  site_id: number;
  language: string;
  keyword?: string;
  article_title?: string;
  github_url?: string | null;
  image_url?: string | null;
  status: string;
  error?: string;
}

interface ApiResponse {
  success: boolean;
  keyword?: string;
  article_title?: string;
  github_url?: string | null;
  image_url?: string | null;
  status?: string;
  error?: string;
}

const LANG_FLAG: Record<string, string> = {
  fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹",
};

async function runAutopilotForSite(siteId: number, language: string): Promise<ApiResponse> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

  const res = await fetch(`${baseUrl}/api/autopilot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site_id: siteId, dry_run: false, language }),
  });

  return res.json() as Promise<ApiResponse>;
}

async function sendEmailRecap(results: AutopilotResult[]): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.ALERT_EMAIL;

  if (!resendKey || !alertEmail) return;

  const published = results.filter((r) => r.status === "published");
  const failed = results.filter((r) => r.status !== "published");

  // Group by language for the recap
  const byLang: Record<string, AutopilotResult[]> = {};
  for (const r of published) {
    (byLang[r.language] ??= []).push(r);
  }

  const langBlocks = Object.entries(byLang)
    .map(([lang, items]) => {
      const flag = LANG_FLAG[lang] ?? lang.toUpperCase();
      return `<h4>${flag} ${lang.toUpperCase()} — ${items.length} article(s)</h4>
<ul>
  ${items
    .map(
      (r) =>
        `<li><strong>${r.site}</strong>: "${r.keyword ?? r.article_title ?? "–"}"${r.github_url ? ` — <a href="${r.github_url}">GitHub</a>` : ""}</li>`
    )
    .join("")}
</ul>`;
    })
    .join("");

  const html = `
<h2>SEO Autopilot — Récap hebdomadaire multi-pays</h2>
<p>${published.length} article(s) publié(s) sur ${Object.keys(byLang).length} langue(s)</p>

${langBlocks}

${
  failed.length > 0
    ? `<h3>❌ Échecs (${failed.length})</h3>
<ul>
  ${failed.map((r) => `<li><strong>${r.site}</strong> [${r.language}]: ${r.error ?? r.status}</li>`).join("")}
</ul>`
    : ""
}

<p style="color:#888;font-size:12px">SEO Dashboard Autopilot — ${new Date().toLocaleDateString("fr-FR")}</p>
  `.trim();

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "SEO Dashboard <onboarding@resend.dev>",
        to: [alertEmail],
        subject: `SEO Autopilot — ${published.length} article(s) publié(s) cette semaine`,
        html,
      }),
    });
  } catch (err) {
    console.error("Failed to send recap email:", err);
  }
}

export async function POST() {
  const sql = getSQL();

  try {
    // Get all active sites with their target languages
    const sites = (await sql`
      SELECT DISTINCT s.id, s.name, s.url, s.target_languages
      FROM sites s
      INNER JOIN search_console_data scd ON scd.site_id = s.id
      WHERE s.is_active = true
        AND scd.date >= NOW() - INTERVAL '30 days'
      ORDER BY s.id
    `) as Site[];

    if (sites.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No active sites with GSC data found",
        results: [],
      });
    }

    const results: AutopilotResult[] = [];

    // Loop sites × target_languages
    for (const site of sites) {
      const languages = (site.target_languages && site.target_languages.length > 0)
        ? site.target_languages
        : ["fr"];

      for (const language of languages) {
        try {
          const result = await runAutopilotForSite(site.id, language);
          results.push({
            site: site.name,
            site_id: site.id,
            language,
            keyword: result.keyword,
            article_title: result.article_title,
            github_url: result.github_url,
            image_url: result.image_url,
            status: result.status ?? (result.error ? "failed" : "unknown"),
            error: result.error,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          results.push({
            site: site.name,
            site_id: site.id,
            language,
            status: "failed",
            error: message,
          });
        }
      }
    }

    // Send email recap
    await sendEmailRecap(results);

    const published = results.filter((r) => r.status === "published").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      success: true,
      total_sites: sites.length,
      total_runs: results.length,
      published,
      failed,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Weekly autopilot error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
