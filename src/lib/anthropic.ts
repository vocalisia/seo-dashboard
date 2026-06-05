export async function getAnthropicClient(): Promise<never> {
  throw new Error("Legacy Anthropic client removed. Use askAI() with Gemini/Perplexity routing instead.");
}
