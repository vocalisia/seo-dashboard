export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toFiniteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatFixed(value: unknown, digits = 1, fallback = "-"): string {
  const n = toFiniteNumberOrNull(value);
  return n === null ? fallback : n.toFixed(digits);
}
