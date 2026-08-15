const VERIFIED_VOLUME_MARKERS = ["keyword_planner", "dataforseo", "ahrefs"];

export function isVerifiedKeywordVolumeSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  const normalized = source.trim().toLowerCase();
  if (!normalized || normalized.includes("niche_skip")) return false;
  return normalized.startsWith("google_kp_real_")
    || VERIFIED_VOLUME_MARKERS.some((marker) => normalized.includes(marker));
}

export function resolveVerifiedKeywordVolume(
  source: unknown,
  ...values: unknown[]
): number {
  if (!isVerifiedKeywordVolumeSource(source)) return 0;
  const usable = values.map(Number).filter((value) => Number.isFinite(value) && value > 1);
  return usable.length > 0 ? Math.max(...usable) : 0;
}
