export type OpportunityDeploymentTone = "neutral" | "info" | "warning";

export function normalizeOpportunityDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (domain.length < 4 || domain.length > 253 || domain.includes("/")) return null;
  if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) return null;
  return domain;
}

export function canCreateOpportunityRepository(status: string | null | undefined): boolean {
  return status == null || status === "pending" || status === "planned" || status === "site_registered";
}

export function canRegisterOpportunitySite(status: string | null | undefined): boolean {
  return status == null || status === "pending" || status === "planned";
}

export function opportunityProvisioningState(status: string | null | undefined): {
  site_registered: boolean;
  repository_ready: boolean;
  deployed: boolean;
} {
  return {
    site_registered: status === "site_registered" || status === "repository_ready" || status === "deployed",
    repository_ready: status === "repository_ready" || status === "deployed",
    deployed: status === "deployed",
  };
}

export function opportunityDeploymentState(status: string | null | undefined): {
  label: string;
  tone: OpportunityDeploymentTone;
} {
  if (status === "planned") return { label: "Plan prêt · site non enregistré", tone: "info" };
  if (status === "site_registered") return { label: "Site enregistré · inactif · aucun dépôt", tone: "info" };
  if (status === "repository_ready") return { label: "Dépôt privé prêt · site inactif · non publié", tone: "info" };
  if (status === "deployed") return { label: "Statut deployed reçu · déploiement non vérifié", tone: "warning" };
  if (status === "pending" || !status) return { label: "À préparer", tone: "neutral" };
  return { label: `Statut : ${status}`, tone: "neutral" };
}
