import { describe, expect, it } from "vitest";
import { buildLocalAIPrompts, parseGeneratedAIPrompts } from "./ai-prompt-engine";

describe("local AI prompt engine", () => {
  it("always builds 30 unique structured prompts without an API", () => {
    const prompts = buildLocalAIPrompts("SEO local", "fr");
    expect(prompts).toHaveLength(30);
    expect(new Set(prompts.map((item) => item.prompt)).size).toBe(30);
    expect(new Set(prompts.map((item) => item.intent))).toEqual(new Set(["info", "comm", "transac", "nav"]));
  });

  it("rejects malformed, incomplete or duplicate provider output", () => {
    expect(parseGeneratedAIPrompts("not json")).toBeNull();
    expect(parseGeneratedAIPrompts(JSON.stringify([{ prompt: "Un prompt assez long", intent: "info", reasoning: "x" }]))).toBeNull();
    const duplicate = Array.from({ length: 30 }, () => ({ prompt: "Toujours le même prompt", intent: "info", reasoning: "x" }));
    expect(parseGeneratedAIPrompts(JSON.stringify(duplicate))).toBeNull();
  });
});
