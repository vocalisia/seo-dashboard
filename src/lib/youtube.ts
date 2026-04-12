import { google } from "googleapis";

export type ChannelInfo = {
  id: string;
  name: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  thumbnail: string;
  url: string;
};

export type VideoInfo = {
  id: string;
  title: string;
  channelName: string;
  views: number;
  likes: number;
  publishedAt: string;
  thumbnail: string;
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
  estimatedCPM: { min: number; max: number };
  recommendation: string;
  error?: string;
};

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

function calcCPM(keyword: string): { min: number; max: number } {
  const kw = keyword.toLowerCase();
  if (/invest|stock|trading|bourse|crypto|finance|argent|wealth/.test(kw)) return { min: 18, max: 38 };
  if (/business|entrepreneur|startup|saas|agence|dropshipping/.test(kw)) return { min: 15, max: 30 };
  if (/immobilier|real estate|patrimoine/.test(kw)) return { min: 12, max: 28 };
  if (/legal|juridique|impôt|tax|avocat|comptable/.test(kw)) return { min: 14, max: 32 };
  if (/ia|intelligence artificielle|ai|automatisation|automation|gpt/.test(kw)) return { min: 13, max: 26 };
  if (/tech|logiciel|software|coding|code|dev|programmer/.test(kw)) return { min: 10, max: 22 };
  if (/santé|health|fitness|nutrition|régime|sport/.test(kw)) return { min: 10, max: 20 };
  if (/education|formation|apprendre|cours|tutorial/.test(kw)) return { min: 8, max: 16 };
  if (/gaming|jeu|game/.test(kw)) return { min: 4, max: 10 };
  if (/musique|music|vlog|entertainment/.test(kw)) return { min: 3, max: 8 };
  return { min: 6, max: 14 };
}

export async function scanNiche(keyword: string, accessToken?: string): Promise<NicheScanResult> {
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
  const estimatedCPM = calcCPM(keyword);

  const recommendation =
    opportunityScore >= 75 ? "🟢 Excellente opportunité — forte demande, faible concurrence" :
    opportunityScore >= 58 ? "🟡 Bonne opportunité — marché accessible avec du potentiel" :
    opportunityScore >= 42 ? "🟠 Opportunité modérée — concurrence présente, différenciation nécessaire" :
    "🔴 Niche saturée — très compétitif, difficile à percer";

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
    estimatedCPM,
    recommendation,
  };
}
