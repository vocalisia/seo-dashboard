export type OpportunityDeploymentTone = "neutral" | "info" | "warning";

export function normalizeOpportunityDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (domain.length < 4 || domain.length > 253 || domain.includes("/")) return null;
  if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) return null;
  return domain;
}

export function canCreateOpportunityRepository(status: string | null | undefined): boolean {
  return status == null || status === "pending" || status === "planned";
}

export function opportunityDeploymentState(status: string | null | undefined): {
  label: string;
  tone: OpportunityDeploymentTone;
} {
  if (status === "planned") return { label: "Plan prêt · aucun dépôt", tone: "info" };
  if (status === "repository_ready") return { label: "Dépôt privé prêt · non publié", tone: "info" };
  if (status === "deployed") return { label: "Publication déclarée · live à vérifier", tone: "warning" };
  if (status === "pending" || !status) return { label: "À préparer", tone: "neutral" };
  return { label: `Statut : ${status}`, tone: "neutral" };
}
