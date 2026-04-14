/**
 * Dashboard utilisable en local sans Postgres / sans Vercel.
 * En `development`, si `DATABASE_URL` est vide → données de démo (liste de sites + APIs vides).
 * Pour afficher l’erreur « DATABASE_URL manquant » à la place : `LOCAL_DEV_REQUIRE_DB=true` dans `.env.local`.
 */
export function isLocalDevDemoMode(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (process.env.LOCAL_DEV_REQUIRE_DB === "true") return false;
  return !process.env.DATABASE_URL?.trim();
}

/** Lignes au format proche du SELECT `/api/sites` (snake_case). */
export const LOCAL_DEMO_SITES: Record<string, unknown>[] = [
  {
    id: 1,
    name: "Site démo — local (sans base)",
    url: "https://example.local",
    ga_property_id: null,
    gsc_property: null,
    is_active: true,
    created_at: new Date().toISOString(),
    target_languages: ["fr", "en"],
    total_sessions_30d: 1200,
    total_users_30d: 890,
    total_pageviews_30d: 3400,
    organic_sessions_30d: 720,
    gsc_clicks_30d: 8420,
    gsc_impressions_30d: 412000,
    avg_position_30d: 11.2,
  },
  {
    id: 2,
    name: "Autre démo locale",
    url: "https://demo-2.local",
    ga_property_id: null,
    gsc_property: null,
    is_active: true,
    created_at: new Date().toISOString(),
    target_languages: ["fr"],
    total_sessions_30d: 0,
    total_users_30d: 0,
    total_pageviews_30d: 0,
    organic_sessions_30d: 0,
    gsc_clicks_30d: 2100,
    gsc_impressions_30d: 98000,
    avg_position_30d: 18.5,
  },
];
