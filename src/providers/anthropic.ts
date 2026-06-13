import type { ProviderAdapter } from "./provider.js";
import type { TokenUsage } from "../types.js";
import { estimateMessagesTokens } from "./provider.js";

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",
  matches: (m) => m.startsWith("claude-"),
  estimateInputTokens: (input) => estimateMessagesTokens(input),
  extractUsage: (response: any): TokenUsage | undefined => {
    const u = response?.usage;
    if (!u) return undefined;
    if (u.input_tokens == null && u.output_tokens == null) return undefined;
    return {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cachedInputTokens: u.cache_read_input_tokens,
    };
  },
};
