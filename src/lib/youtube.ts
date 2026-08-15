import { google } from "googleapis";

export type ChannelInfo = {
  id: string;
  name: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  thumbnail: string;
  url: string;
  statisticsAvailable: boolean;
};

export type VideoInfo = {
  id: string;
  title: string;
  channelName: string;
  views: number;
  likes: number;
  publishedAt: string;
  thumbnail: string;
  viewsAvailable: boolean;
  likesAvailable: boolean;
};

export type NicheScanResult = {
  keyword: string;
  channelCount: number;
  avgSubscribers: number;
  topChannels: ChannelInfo[];
  recentTopVideos: VideoInfo[];
  avgRecentViews: number;
  demandScore: number;
  competitionScore: number;
  opportunityScore: number;
  monetizationSignal: "high" | "medium" | "low";
  monetizationBasis: "keyword_category_heuristic";
  measurementSource: "youtube_data_api" | "youtube_public_search" | "unavailable";
  measurementWindow: "last_90_days" | "current_search_results" | "unavailable";
  subscriberDataStatus: "complete" | "partial" | "unavailable";
  likeDataStatus: "complete" | "unavailable";
  fallbackReason?: string;
  recommendation: string;
  error?: string;
};

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type PublicChannelSeed = {
  id: string;
  name: string;
  path: string | null;
  thumbnail: string;
};

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pathValue(value: JsonValue | undefined, path: Array<string | number>): JsonValue | undefined {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      const object = asObject(current);
      if (!object) return undefined;
      current = object[segment];
    }
  }
  return current;
}

function textValue(value: JsonValue | undefined): string {
  if (typeof value === "string") return value.trim();
  const object = asObject(value);
  if (!object) return "";
  if (typeof object.simpleText === "string") return object.simpleText.trim();
  if (!Array.isArray(object.runs)) return "";
  return object.runs
    .map((run) => {
      const record = asObject(run);
      return typeof record?.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
}

function normalizeAssetUrl(rawValue: JsonValue | undefined): string {
  if (typeof rawValue !== "string") return "";
  if (rawValue.startsWith("//")) return `https:${rawValue}`;
  return /^https:\/\//i.test(rawValue) ? rawValue : "";
}

function thumbnailUrl(renderer: JsonObject): string {
  const thumbnails = pathValue(renderer, ["thumbnail", "thumbnails"]);
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return "";
  const last = asObject(thumbnails[thumbnails.length - 1]);
  return normalizeAssetUrl(last?.url);
}

function channelPath(rawValue: JsonValue | undefined): string | null {
  if (typeof rawValue !== "string") return null;
  const clean = rawValue.split(/[?#]/, 1)[0];
  return /^\/(?:@|channel\/|c\/|user\/)[^/\s]+/i.test(clean) ? clean : null;
}

export function parseYouTubeCount(rawValue: string): number {
  const compact = rawValue.toLowerCase().replace(/[\s\u00a0\u202f]/g, "");
  const match = compact.match(/(\d+(?:[.,]\d+)?)(md|k|m|b)?/i);
  if (!match) return 0;
  const suffix = (match[2] ?? "").toLowerCase();
  const numeric = suffix
    ? Number(match[1].replace(",", "."))
    : Number(match[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" || suffix === "md" ? 1_000_000_000 : 1;
  return Math.round(numeric * multiplier);
}

function assignedJson(html: string): JsonValue {
  const markers = ["var ytInitialData =", "window[\"ytInitialData\"] =", "ytInitialData ="];
  let objectStart = -1;
  for (const marker of markers) {
    const assignment = html.indexOf(marker);
    if (assignment >= 0) {
      objectStart = html.indexOf("{", assignment + marker.length);
      if (objectStart >= 0) break;
    }
  }
  if (objectStart < 0) throw new Error("YouTube n'a pas exposé les résultats publics attendus");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < html.length; index++) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(objectStart, index + 1)) as JsonValue;
    }
  }
  throw new Error("Résultats publics YouTube tronqués");
}

function collectRenderers(root: JsonValue, rendererKey: "videoRenderer" | "channelRenderer"): JsonObject[] {
  const renderers: JsonObject[] = [];
  const visit = (value: JsonValue) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const object = asObject(value);
    if (!object) return;
    const renderer = asObject(object[rendererKey]);
    if (renderer) renderers.push(renderer);
    Object.values(object).forEach(visit);
  };
  visit(root);
  return renderers;
}

function jsonStringField(html: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "u"));
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return "";
  }
}

export function getYouTubeClient(accessToken?: string) {
  if (accessToken) {
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: accessToken });
    return google.youtube({ version: "v3", auth: oauth2 as never });
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY non configurée dans les variables d'environnement");
  return google.youtube({ version: "v3", auth: apiKey });
}

function calcDemandScore(avgViews: number): number {
  if (avgViews >= 2_000_000) return 98;
  if (avgViews >= 1_000_000) return 90;
  if (avgViews >= 500_000) return 80;
  if (avgViews >= 200_000) return 70;
  if (avgViews >= 100_000) return 60;
  if (avgViews >= 50_000) return 48;
  if (avgViews >= 20_000) return 35;
  if (avgViews >= 5_000) return 22;
  return 10;
}

function calcCompetitionScore(avgSubs: number, channelCount: number): number {
  const subScore = (() => {
    if (avgSubs >= 2_000_000) return 95;
    if (avgSubs >= 1_000_000) return 85;
    if (avgSubs >= 500_000) return 72;
    if (avgSubs >= 100_000) return 58;
    if (avgSubs >= 50_000) return 44;
    if (avgSubs >= 10_000) return 30;
    if (avgSubs >= 1_000) return 18;
    return 8;
  })();
  const saturation = Math.min(20, channelCount);
  return Math.min(100, subScore + saturation);
}

export function classifyYouTubeMonetization(keyword: string): NicheScanResult["monetizationSignal"] {
  const kw = keyword.toLowerCase();
  if (/invest|stock|trading|bourse|crypto|finance|argent|wealth|business|entrepreneur|startup|saas|immobilier|real estate|patrimoine|legal|juridique|impôt|tax|avocat|comptable/.test(kw)) return "high";
  if (/ia|intelligence artificielle|ai|automatisation|automation|gpt|tech|logiciel|software|coding|code|dev|programmer|santé|health|fitness|nutrition|régime|sport|education|formation|apprendre|cours|tutorial/.test(kw)) return "medium";
  return "low";
}

function recommendationForScore(score: number, publicSearch = false): string {
  const suffix = publicSearch ? " dans les résultats publics observés" : " mesurée sur les 90 derniers jours";
  if (score >= 75) return `Forte opportunité${suffix} — demande élevée et concurrence relativement faible`;
  if (score >= 58) return `Opportunité accessible${suffix} — potentiel à confirmer par un test éditorial`;
  if (score >= 42) return `Opportunité modérée${suffix} — différenciation éditoriale nécessaire`;
  return `Concurrence élevée par rapport à la demande${suffix}`;
}

function publicChannelSeed(renderer: JsonObject): PublicChannelSeed | null {
  const id = typeof renderer.channelId === "string" ? renderer.channelId : "";
  const name = textValue(renderer.title) || textValue(renderer.shortBylineText);
  if (!id && !name) return null;
  const path = channelPath(
    pathValue(renderer, ["navigationEndpoint", "commandMetadata", "webCommandMetadata", "url"])
      ?? pathValue(renderer, ["navigationEndpoint", "browseEndpoint", "canonicalBaseUrl"]),
  );
  return { id: id || name.toLowerCase(), name: name || id, path, thumbnail: thumbnailUrl(renderer) };
}

function videoOwnerSeed(renderer: JsonObject): PublicChannelSeed | null {
  const run = asObject(pathValue(renderer, ["ownerText", "runs", 0]));
  if (!run) return null;
  const name = typeof run.text === "string" ? run.text.trim() : "";
  const idValue = pathValue(run, ["navigationEndpoint", "browseEndpoint", "browseId"]);
  const id = typeof idValue === "string" ? idValue : "";
  if (!id && !name) return null;
  const path = channelPath(
    pathValue(run, ["navigationEndpoint", "commandMetadata", "webCommandMetadata", "url"])
      ?? pathValue(run, ["navigationEndpoint", "browseEndpoint", "canonicalBaseUrl"]),
  );
  return { id: id || name.toLowerCase(), name: name || id, path, thumbnail: "" };
}

async function fetchPublicChannelInfo(seed: PublicChannelSeed): Promise<ChannelInfo> {
  const basePath = seed.path ?? (seed.id.startsWith("UC") ? `/channel/${seed.id}` : null);
  if (!basePath) {
    return { ...seed, subscribers: 0, totalViews: 0, videoCount: 0, url: "", statisticsAvailable: false };
  }
  const aboutUrl = new URL(`${basePath.replace(/\/$/, "")}/about`, "https://www.youtube.com");
  aboutUrl.searchParams.set("hl", "fr");
  aboutUrl.searchParams.set("gl", "CH");
  try {
    const response = await fetch(aboutUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; SEO-Dashboard/1.0)" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const subscriberText = jsonStringField(html, "subscriberCountText");
    const viewText = jsonStringField(html, "viewCountText");
    const videoText = jsonStringField(html, "videoCountText");
    return {
      id: seed.id,
      name: seed.name,
      subscribers: parseYouTubeCount(subscriberText),
      totalViews: parseYouTubeCount(viewText),
      videoCount: parseYouTubeCount(videoText),
      thumbnail: seed.thumbnail,
      url: new URL(basePath, "https://www.youtube.com").toString(),
      statisticsAvailable: Boolean(subscriberText || viewText || videoText),
    };
  } catch {
    return {
      id: seed.id,
      name: seed.name,
      subscribers: 0,
      totalViews: 0,
      videoCount: 0,
      thumbnail: seed.thumbnail,
      url: new URL(basePath, "https://www.youtube.com").toString(),
      statisticsAvailable: false,
    };
  }
}

async function scanNicheFromPublicSearch(keyword: string): Promise<NicheScanResult> {
  const searchUrl = new URL("https://www.youtube.com/results");
  searchUrl.searchParams.set("search_query", keyword);
  searchUrl.searchParams.set("hl", "fr");
  searchUrl.searchParams.set("gl", "CH");
  const response = await fetch(searchUrl, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; SEO-Dashboard/1.0)" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Recherche publique YouTube indisponible (HTTP ${response.status})`);
  const html = await response.text();
  const initialData = assignedJson(html);
  const channelSeeds = new Map<string, PublicChannelSeed>();
  for (const renderer of collectRenderers(initialData, "channelRenderer")) {
    const seed = publicChannelSeed(renderer);
    if (seed) channelSeeds.set(seed.id, seed);
  }

  const videosById = new Map<string, VideoInfo>();
  for (const renderer of collectRenderers(initialData, "videoRenderer")) {
    const id = typeof renderer.videoId === "string" ? renderer.videoId : "";
    const title = textValue(renderer.title);
    if (!id || !title || videosById.has(id)) continue;
    const viewText = textValue(renderer.viewCountText) || textValue(renderer.shortViewCountText);
    const owner = videoOwnerSeed(renderer);
    if (owner && !channelSeeds.has(owner.id)) channelSeeds.set(owner.id, owner);
    videosById.set(id, {
      id,
      title,
      channelName: owner?.name ?? textValue(renderer.ownerText),
      views: parseYouTubeCount(viewText),
      likes: 0,
      publishedAt: textValue(renderer.publishedTimeText),
      thumbnail: thumbnailUrl(renderer),
      viewsAvailable: Boolean(viewText),
      likesAvailable: false,
    });
    if (videosById.size >= 20) break;
  }

  const recentTopVideos = [...videosById.values()]
    .sort((left, right) => right.views - left.views)
    .slice(0, 8);
  if (recentTopVideos.length === 0) throw new Error("Aucune vidéo mesurable dans les résultats publics YouTube");

  const topChannels = await Promise.all([...channelSeeds.values()].slice(0, 6).map(fetchPublicChannelInfo));
  const measuredChannels = topChannels.filter((channel) => channel.statisticsAvailable);
  const measuredVideos = recentTopVideos.filter((video) => video.viewsAvailable);
  const avgSubscribers = measuredChannels.length > 0
    ? measuredChannels.reduce((sum, channel) => sum + channel.subscribers, 0) / measuredChannels.length
    : 0;
  const avgRecentViews = measuredVideos.length > 0
    ? measuredVideos.reduce((sum, video) => sum + video.views, 0) / measuredVideos.length
    : 0;
  const channelCount = channelSeeds.size;
  const demandScore = calcDemandScore(avgRecentViews);
  const competitionScore = calcCompetitionScore(avgSubscribers, channelCount);
  const opportunityScore = Math.round((demandScore + (100 - competitionScore)) / 2);

  return {
    keyword,
    channelCount,
    avgSubscribers: Math.round(avgSubscribers),
    topChannels,
    recentTopVideos,
    avgRecentViews: Math.round(avgRecentViews),
    demandScore,
    competitionScore,
    opportunityScore,
    monetizationSignal: classifyYouTubeMonetization(keyword),
    monetizationBasis: "keyword_category_heuristic",
    measurementSource: "youtube_public_search",
    measurementWindow: "current_search_results",
    subscriberDataStatus: measuredChannels.length === 0 ? "unavailable" : measuredChannels.length === topChannels.length ? "complete" : "partial",
    likeDataStatus: "unavailable",
    recommendation: recommendationForScore(opportunityScore, true),
  };
}

async function scanNicheWithDataApi(keyword: string, accessToken?: string): Promise<NicheScanResult> {
  const yt = getYouTubeClient(accessToken);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Search channels in this niche
  const channelSearch = await yt.search.list({
    q: keyword,
    type: ["channel"],
    maxResults: 20,
    order: "viewCount",
    part: ["snippet"],
  });

  const channelIds = (channelSearch.data.items ?? [])
    .map(item => item.snippet?.channelId ?? item.id?.channelId)
    .filter((id): id is string => Boolean(id));

  // Get channel statistics
  const channelStats = channelIds.length > 0
    ? await yt.channels.list({ id: channelIds, part: ["statistics", "snippet"] })
    : { data: { items: [] } };

  const topChannels: ChannelInfo[] = (channelStats.data.items ?? []).map(ch => ({
    id: ch.id ?? "",
    name: ch.snippet?.title ?? "",
    subscribers: parseInt(ch.statistics?.subscriberCount ?? "0"),
    totalViews: parseInt(ch.statistics?.viewCount ?? "0"),
    videoCount: parseInt(ch.statistics?.videoCount ?? "0"),
    thumbnail: ch.snippet?.thumbnails?.default?.url ?? "",
    url: `https://www.youtube.com/channel/${ch.id}`,
    statisticsAvailable: true,
  })).sort((a, b) => b.subscribers - a.subscribers);

  // Search recent top videos (last 90 days)
  const videoSearch = await yt.search.list({
    q: keyword,
    type: ["video"],
    maxResults: 25,
    order: "viewCount",
    publishedAfter: ninetyDaysAgo,
    part: ["snippet"],
  });

  const videoIds = (videoSearch.data.items ?? [])
    .map(item => item.id?.videoId)
    .filter((id): id is string => Boolean(id));

  // Get video statistics
  const videoStats = videoIds.length > 0
    ? await yt.videos.list({ id: videoIds, part: ["statistics", "snippet"] })
    : { data: { items: [] } };

  const recentTopVideos: VideoInfo[] = (videoStats.data.items ?? []).map(v => ({
    id: v.id ?? "",
    title: v.snippet?.title ?? "",
    channelName: v.snippet?.channelTitle ?? "",
    views: parseInt(v.statistics?.viewCount ?? "0"),
    likes: parseInt(v.statistics?.likeCount ?? "0"),
    publishedAt: v.snippet?.publishedAt ?? "",
    thumbnail: v.snippet?.thumbnails?.default?.url ?? "",
    viewsAvailable: true,
    likesAvailable: v.statistics?.likeCount != null,
  })).sort((a, b) => b.views - a.views);

  // Calculate metrics
  const avgSubs = topChannels.length > 0
    ? topChannels.reduce((s, c) => s + c.subscribers, 0) / topChannels.length
    : 0;

  const avgViews = recentTopVideos.length > 0
    ? recentTopVideos.reduce((s, v) => s + v.views, 0) / recentTopVideos.length
    : 0;

  const demandScore = calcDemandScore(avgViews);
  const competitionScore = calcCompetitionScore(avgSubs, channelIds.length);
  const opportunityScore = Math.round((demandScore + (100 - competitionScore)) / 2);
  const monetizationSignal = classifyYouTubeMonetization(keyword);

  return {
    keyword,
    channelCount: channelIds.length,
    avgSubscribers: Math.round(avgSubs),
    topChannels: topChannels.slice(0, 8),
    recentTopVideos: recentTopVideos.slice(0, 8),
    avgRecentViews: Math.round(avgViews),
    demandScore,
    competitionScore,
    opportunityScore,
    monetizationSignal,
    monetizationBasis: "keyword_category_heuristic",
    measurementSource: "youtube_data_api",
    measurementWindow: "last_90_days",
    subscriberDataStatus: "complete",
    likeDataStatus: "complete",
    recommendation: recommendationForScore(opportunityScore),
  };
}

export async function scanNiche(keyword: string, accessToken?: string): Promise<NicheScanResult> {
  const apiConfigured = Boolean(accessToken || process.env.YOUTUBE_API_KEY?.trim());
  if (!apiConfigured) return scanNicheFromPublicSearch(keyword);

  try {
    return await scanNicheWithDataApi(keyword, accessToken);
  } catch {
    try {
      const fallback = await scanNicheFromPublicSearch(keyword);
      return { ...fallback, fallbackReason: "YouTube Data API indisponible; recherche publique utilisée." };
    } catch (publicError) {
      const detail = publicError instanceof Error ? publicError.message : "erreur inconnue";
      throw new Error(`YouTube Data API et recherche publique indisponibles: ${detail}`);
    }
  }
}
