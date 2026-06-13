import type { ProviderAdapter } from "./provider.js";
import type { TokenUsage } from "../types.js";
import { openaiAdapter } from "./openai.js";
import { anthropicAdapter } from "./anthropic.js";
import { geminiAdapter } from "./gemini.js";
import { mistralAdapter } from "./mistral.js";

export const ADAPTERS: ProviderAdapter[] = [openaiAdapter, anthropicAdapter, geminiAdapter, mistralAdapter];
const byName = new Map(ADAPTERS.map((a) => [a.name, a]));

export function getAdapter(provider?: string, model?: string): ProviderAdapter | undefined {
  if (provider && byName.has(provider)) return byName.get(provider);
  if (model) return ADAPTERS.find((a) => a.matches(model));
  return undefined;
}

/** Try the matching adapter first, then every adapter, to read usage from a response. */
export function normalizeUsage(response: unknown, provider?: string, model?: string): TokenUsage | undefined {
  const a = getAdapter(provider, model);
  if (a) {
    const u = a.extractUsage(response);
    if (u) return u;
  }
  for (const adapter of ADAPTERS) {
    const u = adapter.extractUsage(response);
    if (u) return u;
  }
  return undefined;
}

export type { ProviderAdapter } from "./provider.js";
