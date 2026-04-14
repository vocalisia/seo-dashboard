import type { SiteRepoConfig } from "./autopilot-config";
import { slugify } from "./autopilot-utils";

/**
 * URL publique de l’article (même règle que l’indexation Google dans POST /api/autopilot).
 */
export function buildPublishedArticleUrl(
  siteUrl: string,
  keyword: string,
  language: string,
  repoConfig: SiteRepoConfig | null
): string {
  const articleSlug = slugify(keyword);
  const langPrefix =
    !repoConfig?.i18nBlogPath && language !== "fr" ? `${language}-` : "";
  const blogPath = repoConfig?.i18nBlogPath
    ? repoConfig.i18nBlogPath[language] ??
      repoConfig.i18nBlogPath["default"] ??
      "/blog"
    : "/blog";
  return `${siteUrl.replace(/\/$/, "")}${blogPath}/${langPrefix}${articleSlug}`;
}
