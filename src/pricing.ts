import type { PricingTable, ModelPricing } from "./types.js";

/**
 * Default price table in USD per 1,000,000 tokens.
 *
 * Prices drift over time and vary by region/tier. Override any model via
 * Policy.pricing or new RateLimiter({ pricing }). Unknown models are tracked
 * at $0 and flagged (pricingKnown=false) so spend is never silently wrong.
 */
export const DEFAULT_PRICING: PricingTable = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "o3": { input: 2, output: 8 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  // Anthropic
  "claude-opus-4": { input: 15, output: 75, cachedInput: 1.5 },
  "claude-sonnet-4": { input: 3, output: 15, cachedInput: 0.3 },
  "claude-3-7-sonnet": { input: 3, output: 15 },
  "claude-3-5-sonnet": { input: 3, output: 15, cachedInput: 0.3 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-opus": { input: 15, output: 75 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  // Google Gemini
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  // Mistral
  "mistral-large": { input: 2, output: 6 },
  "mistral-small": { input: 0.2, output: 0.6 },
  "open-mistral-nemo": { input: 0.15, output: 0.15 },
};

const PROVIDER_PREFIXES: [string, string][] = [
  ["gpt-", "openai"],
  ["o1", "openai"],
  ["o3", "openai"],
  ["o4", "openai"],
  ["text-", "openai"],
  ["claude-", "anthropic"],
  ["gemini-", "gemini"],
  ["mistral-", "mistral"],
  ["open-mistral", "mistral"],
  ["open-mixtral", "mistral"],
];

export function providerOf(model: string): string | undefined {
  for (const [p, name] of PROVIDER_PREFIXES) if (model.startsWith(p)) return name;
  return undefined;
}

export interface ResolvedPricing {
  price: ModelPricing;
  known: boolean;
  provider?: string;
  matched?: string;
}

/**
 * Resolve pricing for a model. Tries exact match, then the longest matching
 * prefix (so "gpt-4o-2024-11-20" maps to "gpt-4o"). Override table is merged
 * on top of the defaults.
 */
export function resolvePricing(model: string, override?: PricingTable, provider?: string): ResolvedPricing {
  const table: PricingTable = override ? { ...DEFAULT_PRICING, ...override } : DEFAULT_PRICING;
  const prov = provider ?? providerOf(model);
  const exact = table[model];
  if (exact) return { price: exact, known: true, provider: prov, matched: model };
  let best: string | undefined;
  for (const k of Object.keys(table)) {
    if (model.startsWith(k) && (best === undefined || k.length > best.length)) best = k;
  }
  if (best) return { price: table[best]!, known: true, provider: prov, matched: best };
  return { price: { input: 0, output: 0 }, known: false, provider: prov };
}
