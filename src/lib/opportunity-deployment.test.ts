import { describe, expect, it } from "vitest";
import {
  canCreateOpportunityRepository,
  canRegisterOpportunitySite,
  normalizeOpportunityDomain,
  opportunityDeploymentState,
  opportunityProvisioningState,
} from "./opportunity-deployment";

describe("opportunity deployment truth", () => {
  it("normalizes a plain domain and rejects paths or invalid hosts", () => {
    expect(normalizeOpportunityDomain("https://SEO-SWISS.ch/")).toBe("seo-swiss.ch");
    expect(normalizeOpportunityDomain("seo-swiss.ch/private")).toBeNull();
    expect(normalizeOpportunityDomain("not a domain")).toBeNull();
  });

  it("never presents a plan or repository as deployed", () => {
    expect(opportunityDeploymentState("planned").label).toContain("site non enregistré");
    expect(opportunityDeploymentState("site_registered").label).toContain("aucun dépôt");
    expect(opportunityDeploymentState("repository_ready").label).toContain("non publié");
    expect(opportunityDeploymentState("deployed").label).toContain("non vérifié");
  });

  it("keeps site registration, repository readiness and deployment separate", () => {
    expect(opportunityProvisioningState("site_registered")).toEqual({
      site_registered: true,
      repository_ready: false,
      deployed: false,
    });
    expect(opportunityProvisioningState("repository_ready")).toEqual({
      site_registered: true,
      repository_ready: true,
      deployed: false,
    });
    expect(opportunityProvisioningState("deployed")).toEqual({
      site_registered: true,
      repository_ready: true,
      deployed: true,
    });
  });

  it("allows repository creation after site registration but not after repository creation", () => {
    expect(canCreateOpportunityRepository("planned")).toBe(true);
    expect(canCreateOpportunityRepository("site_registered")).toBe(true);
    expect(canCreateOpportunityRepository("repository_ready")).toBe(false);
  });

  it("registers a site only before that state has been recorded", () => {
    expect(canRegisterOpportunitySite("planned")).toBe(true);
    expect(canRegisterOpportunitySite("site_registered")).toBe(false);
    expect(canRegisterOpportunitySite("repository_ready")).toBe(false);
    expect(canRegisterOpportunitySite("deployed")).toBe(false);
  });
});
