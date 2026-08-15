export type GA4AuditStatus = "ok" | "no_data" | "not_configured";

export function classifyGA4AuditStatus(propertyId: unknown, sessions30d: unknown): GA4AuditStatus {
  if (typeof propertyId !== "string" || propertyId.trim() === "") return "not_configured";
  const sessions = Number(sessions30d);
  return Number.isFinite(sessions) && sessions > 0 ? "ok" : "no_data";
}
