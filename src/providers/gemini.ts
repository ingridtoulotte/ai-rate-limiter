import type { ProviderAdapter } from "./provider.js";
import type { TokenUsage } from "../types.js";
import { estimateMessagesTokens } from "./provider.js";

export const geminiAdapter: ProviderAdapter = {
  name: "gemini",
  matches: (m) => m.startsWith("gemini-"),
  estimateInputTokens: (input) => estimateMessagesTokens(input),
  extractUsage: (response: any): TokenUsage | undefined => {
    const u = response?.usageMetadata ?? response?.usage_metadata;
    if (!u) return undefined;
    const input = u.promptTokenCount ?? u.prompt_token_count;
    const output = u.candidatesTokenCount ?? u.candidates_token_count;
    if (input == null && output == null) return undefined;
    return {
      inputTokens: input ?? 0,
      outputTokens: output ?? 0,
      cachedInputTokens: u.cachedContentTokenCount ?? u.cached_content_token_count,
    };
  },
};
