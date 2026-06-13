import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, costFromUsage, estimateInputTokens } from "../src/estimate.js";

test("estimateCost: known model uses price table", () => {
  const e = estimateCost({ model: "gpt-4o", inputTokens: 1000, maxOutputTokens: 1000 });
  assert.equal(e.pricingKnown, true);
  assert.equal(e.inputTokens, 1000);
  assert.equal(e.outputTokens, 1000);
  // (1000*2.5 + 1000*10) / 1e6
  assert.ok(Math.abs(e.costUSD - 0.0125) < 1e-9);
});

test("estimateCost: unknown model flagged, cost 0", () => {
  const e = estimateCost({ model: "totally-made-up-1", inputTokens: 1000, maxOutputTokens: 1000 });
  assert.equal(e.pricingKnown, false);
  assert.equal(e.costUSD, 0);
});

test("estimateCost: prefix match (dated model id)", () => {
  const e = estimateCost({ model: "gpt-4o-2024-11-20", inputTokens: 1000, maxOutputTokens: 0 });
  assert.equal(e.pricingKnown, true);
  assert.ok(Math.abs(e.costUSD - 0.0025) < 1e-9);
});

test("costFromUsage: exact usage", () => {
  const e = costFromUsage("gpt-4o", { inputTokens: 1000, outputTokens: 500 });
  // (1000*2.5 + 500*10)/1e6 = 0.0075
  assert.ok(Math.abs(e.costUSD - 0.0075) < 1e-9);
});

test("costFromUsage: cached input discount", () => {
  const e = costFromUsage("claude-sonnet-4", { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 1000 });
  // 1000 cached * 0.3 / 1e6 = 0.0003
  assert.ok(Math.abs(e.costUSD - 0.0003) < 1e-9);
});

test("estimateInputTokens: from messages", () => {
  const n = estimateInputTokens({ model: "gpt-4o", input: { messages: [{ role: "user", content: "hello world" }] } });
  assert.equal(n, Math.ceil("hello world".length / 4));
});
