import { describe, expect, it } from "vitest";
import { scoreReadiness } from "./llm-scan";

const allPassiveBots = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "OAI-SearchBot",
  "Google-Extended",
  "CCBot",
  "FacebookBot",
  "Applebot-Extended",
  "Amazonbot",
  "Meta-ExternalAgent",
];

describe("scoreReadiness", () => {
  it("does not under-score a site with llms.txt, all AI bots reachable, base schemas and Open Graph", () => {
    const result = scoreReadiness(
      true,
      [],
      allPassiveBots,
      ["Organization", "WebSite"],
      true,
    );

    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("keeps fake or missing llms.txt as a major blocker", () => {
    const result = scoreReadiness(
      false,
      [],
      allPassiveBots,
      ["Organization", "WebSite"],
      true,
    );

    expect(result.score).toBeLessThan(50);
    expect(result.recommendations[0]).toContain("/llms.txt");
  });

  it("rewards explicit AI bot rules more than a single passive allow", () => {
    const explicit = scoreReadiness(true, ["GPTBot", "ClaudeBot", "PerplexityBot"], [], [], false);
    const passive = scoreReadiness(true, [], ["GPTBot"], [], false);

    expect(explicit.score).toBeGreaterThan(passive.score);
  });
});
