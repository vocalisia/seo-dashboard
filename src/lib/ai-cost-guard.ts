export function isPaidFallbackEnabled(): boolean {
  return process.env.AI_PAID_FALLBACK_ENABLED === "true";
}

export function paidFallbackDisabledMessage(provider: string): string {
  return `${provider} fallback is disabled. Gemini/Perplexity are preferred; set AI_PAID_FALLBACK_ENABLED=true only when you explicitly want this fallback.`;
}
