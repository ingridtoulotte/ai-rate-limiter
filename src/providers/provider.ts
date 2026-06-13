import type { TokenUsage } from "../types.js";

export interface ProviderAdapter {
  name: string;
  /** true if this adapter handles the given model id */
  matches(model: string): boolean;
  /** best-effort input token estimate from a request body; undefined if unknown shape */
  estimateInputTokens(input: unknown): number | undefined;
  /** pull real token usage out of a provider response; undefined if not recognized */
  extractUsage(response: unknown): TokenUsage | undefined;
}

const CHARS_PER_TOKEN = 4;
export function textTokens(s: string): number {
  return s ? Math.ceil(s.length / CHARS_PER_TOKEN) : 0;
}

/** Walk common chat/message request shapes and sum text length / 4. */
export function estimateMessagesTokens(input: any): number | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") return textTokens(input);
  let total = 0;
  let found = false;
  const messages = input.messages ?? input.contents ?? input.input;
  if (typeof messages === "string") return textTokens(messages);
  if (Array.isArray(messages)) {
    for (const m of messages) {
      found = true;
      total += collectText(m);
    }
  }
  if (typeof input.system === "string") { found = true; total += textTokens(input.system); }
  if (typeof input.prompt === "string") { found = true; total += textTokens(input.prompt); }
  return found ? total : undefined;
}

function collectText(m: any): number {
  if (m == null) return 0;
  if (typeof m === "string") return textTokens(m);
  const c = m.content ?? m.parts ?? m.text;
  if (typeof c === "string") return textTokens(c);
  if (Array.isArray(c)) {
    let t = 0;
    for (const part of c) {
      if (typeof part === "string") t += textTokens(part);
      else if (part && typeof part.text === "string") t += textTokens(part.text);
    }
    return t;
  }
  if (typeof m.text === "string") return textTokens(m.text);
  return 0;
}
