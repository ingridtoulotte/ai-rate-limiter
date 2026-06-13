import type { ProviderAdapter } from "./provider.js";
import type { TokenUsage } from "../types.js";
import { estimateMessagesTokens } from "./provider.js";

export const mistralAdapter: ProviderAdapter = {
  name: "mistral",
  matches: (m) => m.startsWith("mistral-") || m.startsWith("open-mistral") || m.startsWith("open-mixtral"),
  estimateInputTokens: (input) => estimateMessagesTokens(input),
  extractUsage: (response: any): TokenUsage | undefined => {
    const u = response?.usage;
    if (!u) return undefined;
    if (u.prompt_tokens == null && u.completion_tokens == null) return undefined;
    return { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 };
  },
};
