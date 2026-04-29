export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronSecret, hasValidCronSecret } from "@/lib/cron-auth";
import { requireApiSession } from "@/lib/api-auth";
import { getGoogleAuth } from "@/lib/google-auth";
import { logAutopilot } from "@/lib/autopilot-log";

interface PublishedRun {
  id: number;
  site_id: number;
  keyword: string;
  github_url: string | null;
  published_url: string;
  language: string | null;
  created_at: string;
}

/**
 * Vérifie chaque article publié récent. Si l'URL renvoie 404 :
 *   1. demande à Google de désindexer (URL_DELETED)
 *   2. tente de supprimer le .mdx du repo GitHub
 *   3. passe la ligne en `status='cleaned_404'` pour qu'elle disparaisse de l'historique
 *
 * Branché en cron quotidien dans vercel.json (`/api/autopilot/verify-urls` à 5h).
 * Auto-healing : aucun nouveau 404 ne survit plus de 24 h.
 */
export async function POST(request: Request) {
  // Soit cron secret, soit session UI
  const cronAuthorized = hasValidCronSecret(request);
  if (!cronAuthorized) {
    const authState = await requireApiSession();
    if (authState.unauthorized) return authState.unauthorized;
  }
  return runVerification();
}

// Vercel cron utilise GET — accepte aussi
export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  return runVerification();
}

async function runVerification() {
  const sql = getSQL();
  const ghToken = process.env.GITHUB_TOKEN;

  // Articles publiés ces 60 derniers jours, jamais nettoyés
  const rows = (await sql`
    SELECT id, site_id, keyword, github_url, published_url, language, created_at
    FROM autopilot_runs
    WHERE status = 'published'
      AND published_url IS NOT NULL
      AND created_at >= NOW() - INTERVAL '60 days'
    ORDER BY created_at DESC
  `) as PublishedRun[];

  logAutopilot("verify_start", { count: rows.length });

  /**
   * Détecte hard 404 (HTTP 4xx) ET soft 404 (HTTP 200 mais `<title>` contient
   * "introuvable" / "not found" / "404"). Beaucoup de sites Next.js renvoient
   * 200 avec une page 404 → un check du code HTTP seul rate ces cas.
   */
  const probe = async (url: string): Promise<"ok" | "dead" | "skip"> => {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (r.status === 404 || r.status === 410) return "dead";
      if (r.status >= 400) return "skip"; // 5xx / 401 / 403 : on ne juge pas
      const html = await r.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim().toLowerCase() : "";
      if (/(introuvable|not\s+found|\b404\b)/i.test(title)) return "dead";
      return "ok";
    } catch {
      return "skip";
    }
  };

  const offenders: PublishedRun[] = [];
  // 6-way concurrent probe (lecture HTML plus chère que HEAD)
  for (let i = 0; i < rows.length; i += 6) {
    const batch = rows.slice(i, i + 6);
    const verdicts = await Promise.all(batch.map((r) => probe(r.published_url)));
    batch.forEach((r, j) => {
      if (verdicts[j] === "dead") offenders.push(r);
    });
  }

  if (offenders.length === 0) {
    logAutopilot("verify_done", { checked: rows.length, offenders: 0 });
    return NextResponse.json({ success: true, checked: rows.length, cleaned: 0, offenders: [] });
  }

  // Auth Google pour désindexation
  let googleToken: string | null = null;
  try {
    const auth = getGoogleAuth();
    const client = (await (auth as { getClient: () => Promise<{ getAccessToken: () => Promise<{ token?: string | null }> }> }).getClient());
    const t = await client.getAccessToken();
    googleToken = t.token ?? null;
  } catch (err) {
    console.error("verify-urls: google auth failed:", err);
  }

  const cleaned: { id: number; url: string; deindexed: boolean; githubDeleted: boolean }[] = [];

  for (const off of offenders) {
    let deindexed = false;
    let githubDeleted = false;

    // 1. Google deindex
    if (googleToken) {
      try {
        const r = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${googleToken}` },
          body: JSON.stringify({ url: off.published_url, type: "URL_DELETED" }),
        });
        deindexed = r.ok;
      } catch (err) {
        console.error("verify-urls: deindex failed:", err);
      }
    }

    // 2. Suppression du .mdx GitHub si on a le github_url
    if (ghToken && off.github_url) {
      const m = off.github_url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/);
      if (m) {
        const [, repo, branch, filePath] = m;
        try {
          // Récupère le sha du fichier
          const headRes = await fetch(
            `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
            { headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" } }
          );
          if (headRes.ok) {
            const j = (await headRes.json()) as { sha?: string };
            if (j.sha) {
              const delRes = await fetch(
                `https://api.github.com/repos/${repo}/contents/${filePath}`,
                {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${ghToken}`,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                  },
                  body: JSON.stringify({
                    message: `chore: auto-cleanup 404 article (verify-urls cron)`,
                    sha: j.sha,
                    branch,
                  }),
                }
              );
              githubDeleted = delRes.ok;
            }
          }
        } catch (err) {
          console.error("verify-urls: github delete failed:", err);
        }
      }
    }

    // 3. Marque la ligne nettoyée
    await sql`UPDATE autopilot_runs SET status = 'cleaned_404' WHERE id = ${off.id}`;

    cleaned.push({ id: off.id, url: off.published_url, deindexed, githubDeleted });
    logAutopilot("verify_cleaned", {
      id: off.id,
      url: off.published_url,
      deindexed,
      githubDeleted,
    });
  }

  // Email alert si > 0
  const resendKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.ALERT_EMAIL;
  if (cleaned.length > 0 && resendKey && alertEmail) {
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
          subject: `🧹 Auto-cleanup 404 — ${cleaned.length} article(s) nettoyé(s)`,
          html: `
<h2>Auto-cleanup 404 articles</h2>
<p>${cleaned.length} article(s) en 404 détecté(s) et nettoyé(s) automatiquement.</p>
<ul>
${cleaned.map((c) => `<li><a href="${c.url}">${c.url}</a> — Google: ${c.deindexed ? "✓" : "✗"} | GitHub: ${c.githubDeleted ? "✓" : "✗"}</li>`).join("")}
</ul>
<p style="color:#888;font-size:12px">Vérification automatique quotidienne — ${new Date().toLocaleString("fr-FR")}</p>
          `.trim(),
        }),
      });
    } catch (err) {
      console.error("verify-urls: alert email failed:", err);
    }
  }

  logAutopilot("verify_done", { checked: rows.length, offenders: offenders.length, cleaned: cleaned.length });

  return NextResponse.json({
    success: true,
    checked: rows.length,
    cleaned: cleaned.length,
    offenders: cleaned,
  });
}
