import type { SiteRepoConfig } from "./autopilot-config";
import { slugify, todayISO } from "./autopilot-utils";

/**
 * Date YYYY-MM-DD alignée sur le slug MDX (`slug: …-${date}`) et le nom de fichier.
 */
export function slugDateFromCreatedAt(createdAt: string | Date): string {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(d.getTime())) return todayISO();
  return d.toISOString().slice(0, 10);
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
  const blogPath = repoConfig?.i18nBlogPath
    ? repoConfig.i18nBlogPath[language] ??
      repoConfig.i18nBlogPath["default"] ??
      "/blog"
    : "/blog";
  const pathSlug = `${langPrefix}${articleSlug}-${slugDate}`;
  return `${siteUrl.replace(/\/$/, "")}${blogPath}/${pathSlug}`;
}
