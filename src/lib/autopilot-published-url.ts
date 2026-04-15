import {
  resolveSiteRepoConfig,
  type SiteRepoConfig,
} from "./autopilot-config";
import { slugify, todayISO } from "./autopilot-utils";

/**
 * Date YYYY-MM-DD alignée sur le slug MDX (`slug: …-${date}`) et le nom de fichier.
 */
export function slugDateFromCreatedAt(createdAt: string | Date): string {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(d.getTime())) return todayISO();
  return d.toISOString().slice(0, 10);
}

/** Préfixe URL du blog (ex. `/blog`, `/fr/blog`) — même règle que les liens internes MDX. */
export function blogPathForLocale(
  repoConfig: SiteRepoConfig | null,
  language: string
): string {
  if (repoConfig?.i18nBlogPath) {
    return (
      repoConfig.i18nBlogPath[language] ??
      repoConfig.i18nBlogPath["default"] ??
      "/blog"
    );
  }
  return "/blog";
}

/**
 * Corrige les liens markdown internes sans "/" (ex. `(fr/blog/slug)`) avant validation.
 * Sinon ils ne sont pas détectés par le regex et le site les résout en chemins relatifs → 404.
 */
export function normalizeAutopilotMarkdownLinks(
  content: string,
  language: string,
  repoConfig: SiteRepoConfig | null
): string {
  const blogBase = blogPathForLocale(repoConfig, language).replace(/\/$/, "");
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, anchor, raw) => {
    const href = String(raw).trim();
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href)) {
      return full;
    }
    if (href.startsWith("#")) return full;
    let u = href;
    if (!u.startsWith("/")) {
      if (/^[a-z]{2}\/blog\//i.test(u)) u = "/" + u;
      else if (/^blog\//i.test(u)) u = `/${language}/blog/` + u.slice(5);
      else if (!u.includes("/")) u = `${blogBase}/${u}`;
    }
    return `[${anchor}](${u})`;
  });
}

/**
 * URL publique de l’article — doit correspondre au `slug` du frontmatter :
 * `slug: "${langPrefix}${articleSlug}-${YYYY-MM-DD}"` (voir POST /api/autopilot).
 * Sans le suffixe date, les sites Next/MDX renvoient souvent 404.
 */
export function buildPublishedArticleUrl(
  siteUrl: string,
  keyword: string,
  language: string,
  repoConfig: SiteRepoConfig | null,
  /** Même jour que dans le frontmatter / fichier publié (souvent `todayISO()` au moment du run). */
  slugDate: string
): string {
  const articleSlug = slugify(keyword);
  const langPrefix =
    !repoConfig?.i18nBlogPath && language !== "fr" ? `${language}-` : "";
  const blogPath = blogPathForLocale(repoConfig, language);
  const pathSlug = `${langPrefix}${articleSlug}-${slugDate}`;
  return `${siteUrl.replace(/\/$/, "")}${blogPath}/${pathSlug}`;
}

/** URL article pour alertes / indexation (même règle que l’historique autopilot). */
export function resolvePublishedArticleLiveUrl(params: {
  siteUrl: string;
  siteName: string;
  keyword: string;
  language: string;
  createdAt: string | Date;
}): string {
  const { repoConfig } = resolveSiteRepoConfig(params.siteName);
  return buildPublishedArticleUrl(
    params.siteUrl,
    params.keyword,
    params.language,
    repoConfig,
    slugDateFromCreatedAt(params.createdAt)
  );
}
