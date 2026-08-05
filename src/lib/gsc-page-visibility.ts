export function normalizeGscPageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return value.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

export function hasGscVisibility(impressions: number | null | undefined): boolean {
  return Number(impressions ?? 0) > 0;
}
