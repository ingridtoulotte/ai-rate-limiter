import type { RequestContext, PricingTable, CostEstimate, TokenUsage } from "./types.js";
import { resolvePricing } from "./pricing.js";
import { getAdapter } from "./providers/index.js";

const CHARS_PER_TOKEN = 4;

export function estimateTokensFromText(text: string): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;
}

/** Input tokens for a request: explicit count > adapter estimate > JSON length / 4. */
export function estimateInputTokens(ctx: RequestContext): number {
  if (typeof ctx.inputTokens === "number") return Math.max(0, Math.round(ctx.inputTokens));
  const adapter = getAdapter(ctx.provider, ctx.model);
  if (adapter && ctx.input != null) {
    const n = adapter.estimateInputTokens(ctx.input);
    if (typeof n === "number") return n;
  }
  if (ctx.input != null) {
    const s = typeof ctx.input === "string" ? ctx.input : JSON.stringify(ctx.input);
    return estimateTokensFromText(s);
  }
  return 0;
}

/** Pre-flight cost estimate (input estimated, output assumed). */
export function estimateCost(ctx: RequestContext, pricing?: PricingTable, defaultMaxOutputTokens = 512): CostEstimate {
  const inputTokens = estimateInputTokens(ctx);
  const outputTokens = Math.max(0, Math.round(ctx.maxOutputTokens ?? defaultMaxOutputTokens));
  const { price, known, provider } = resolvePricing(ctx.model, pricing, ctx.provider);
  const costUSD = known ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : 0;
  return {
    model: ctx.model,
    provider: ctx.provider ?? provider,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUSD,
    pricingKnown: known,
  };
}

/** Exact cost from real provider usage (honors cached-input discount). */
export function costFromUsage(model: string, usage: TokenUsage, pricing?: PricingTable, provider?: string): CostEstimate {
  const { price, known, provider: prov } = resolvePricing(model, pricing, provider);
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, input);
  const billedInput = Math.max(0, input - cached);
  const cachedRate = price.cachedInput ?? price.input;
  const costUSD = known ? (billedInput * price.input + cached * cachedRate + output * price.output) / 1e6 : 0;
  return {
    model,
    provider: provider ?? prov,
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    costUSD,
    pricingKnown: known,
  };
}
