import type { ProviderAdapter } from "./provider.js";
import type { TokenUsage } from "../types.js";
import { estimateMessagesTokens } from "./provider.js";

export const openaiAdapter: ProviderAdapter = {
  name: "openai",
  matches: (m) =>
    m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") ||
    m.startsWith("o4") || m.startsWith("text-"),
  estimateInputTokens: (input) => estimateMessagesTokens(input),
  extractUsage: (response: any): TokenUsage | undefined => {
    const u = response?.usage;
    if (!u) return undefined;
    const input = u.prompt_tokens ?? u.input_tokens;
    const output = u.completion_tokens ?? u.output_tokens;
    if (input == null && output == null) return undefined;
    return {
      inputTokens: input ?? 0,
      outputTokens: output ?? 0,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens,
    };
  },
};
