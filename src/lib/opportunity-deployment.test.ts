import { describe, expect, it } from "vitest";
import {
  canCreateOpportunityRepository,
  normalizeOpportunityDomain,
  opportunityDeploymentState,
} from "./opportunity-deployment";

describe("opportunity deployment truth", () => {
  it("normalizes a plain domain and rejects paths or invalid hosts", () => {
    expect(normalizeOpportunityDomain("https://SEO-SWISS.ch/")).toBe("seo-swiss.ch");
    expect(normalizeOpportunityDomain("seo-swiss.ch/private")).toBeNull();
    expect(normalizeOpportunityDomain("not a domain")).toBeNull();
  });

  it("never presents a plan or repository as deployed", () => {
    expect(opportunityDeploymentState("planned").label).toContain("aucun dépôt");
    expect(opportunityDeploymentState("repository_ready").label).toContain("non publié");
    expect(opportunityDeploymentState("deployed").label).toContain("à vérifier");
  });

  it("allows repository creation only before a repository is ready", () => {
    expect(canCreateOpportunityRepository("planned")).toBe(true);
    expect(canCreateOpportunityRepository("repository_ready")).toBe(false);
  });
});
