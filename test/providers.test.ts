import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsage, getAdapter } from "../src/providers/index.js";
import { estimateMessagesTokens } from "../src/providers/provider.js";

test("openai usage parsed", () => {
  const u = normalizeUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } }, "openai", "gpt-4o");
  assert.deepEqual({ i: u?.inputTokens, o: u?.outputTokens }, { i: 10, o: 5 });
});

test("anthropic usage parsed", () => {
  const u = normalizeUsage({ usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 4 } }, "anthropic", "claude-sonnet-4");
  assert.equal(u?.inputTokens, 12);
  assert.equal(u?.cachedInputTokens, 4);
});

test("gemini usage parsed", () => {
  const u = normalizeUsage({ usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 } }, "gemini", "gemini-2.5-flash");
  assert.equal(u?.inputTokens, 20);
  assert.equal(u?.outputTokens, 8);
});

test("mistral usage parsed", () => {
  const u = normalizeUsage({ usage: { prompt_tokens: 3, completion_tokens: 2 } }, "mistral", "mistral-large");
  assert.equal(u?.inputTokens, 3);
});

test("adapter resolves by model when provider omitted", () => {
  assert.equal(getAdapter(undefined, "claude-3-5-sonnet")?.name, "anthropic");
  assert.equal(getAdapter(undefined, "gpt-4o-mini")?.name, "openai");
});

test("estimateMessagesTokens sums message text", () => {
  const n = estimateMessagesTokens({ messages: [{ role: "user", content: "abcd" }, { role: "assistant", content: "efgh" }] });
  assert.equal(n, 2); // (4+4)/4
});
