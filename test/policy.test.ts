import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/stores/memory.js";
import { evaluate, reconcile, applicableRules, toBase } from "../src/policy.js";
import { estimateCost } from "../src/estimate.js";
import type { Policy, RequestContext } from "../src/types.js";

const now = Date.UTC(2026, 5, 14, 12, 0, 0);

test("request limit denies past the cap and rolls back", async () => {
  const store = new MemoryStore();
  const policy: Policy = { limits: [{ name: "rpm", scope: "user", metric: "requests", limit: 2, window: "minute" }] };
  const ctx: RequestContext = { model: "gpt-4o", userId: "u1" };
  const est = estimateCost(ctx);

  const d1 = await evaluate(store, policy, ctx, est, now, true);
  const d2 = await evaluate(store, policy, ctx, est, now, true);
  const d3 = await evaluate(store, policy, ctx, est, now, true);
  assert.equal(d1.allowed, true);
  assert.equal(d2.allowed, true);
  assert.equal(d3.allowed, false);

  const key = applicableRules(policy, ctx, now)[0]!.key;
  assert.equal(await store.get(key), 2, "denied request must be rolled back");
});

test("reconcile adjusts reserved cost to actual", async () => {
  const store = new MemoryStore();
  const policy: Policy = { limits: [{ name: "spend", scope: "user", metric: "cost", limit: 100, window: "day" }] };
  const ctx: RequestContext = { model: "gpt-4o", userId: "u1", maxOutputTokens: 1000, inputTokens: 1000 };
  const est = estimateCost(ctx); // 0.0125
  const d = await evaluate(store, policy, ctx, est, now, true);
  assert.equal(d.allowed, true);
  const key = applicableRules(policy, ctx, now)[0]!.key;
  assert.equal(await store.get(key), toBase("cost", 0.0125));

  // actual was cheaper (fewer output tokens)
  const actual = estimateCost({ ...ctx, maxOutputTokens: 100 }); // (1000*2.5+100*10)/1e6 = 0.0035
  await reconcile(store, d.reservation!, actual);
  assert.equal(await store.get(key), toBase("cost", 0.0035));
});

test("monitor mode never denies but flags the breach", async () => {
  const store = new MemoryStore();
  const policy: Policy = { limits: [{ name: "rpm", scope: "user", metric: "requests", limit: 1, window: "minute" }] };
  const ctx: RequestContext = { model: "gpt-4o", userId: "u1" };
  const est = estimateCost(ctx);
  await evaluate(store, policy, ctx, est, now, false);
  const d2 = await evaluate(store, policy, ctx, est, now, false);
  assert.equal(d2.allowed, true);
  assert.ok(d2.warnings.some((w) => w.threshold === 1));
});

test("warnAt fires once when crossing a soft threshold", async () => {
  const store = new MemoryStore();
  const policy: Policy = { limits: [{ name: "rpm", scope: "user", metric: "requests", limit: 10, window: "minute", warnAt: [0.8] }] };
  const ctx: RequestContext = { model: "gpt-4o", userId: "u1" };
  const est = estimateCost(ctx);
  let warned = 0;
  for (let i = 0; i < 9; i++) {
    const d = await evaluate(store, policy, ctx, est, now, true);
    warned += d.warnings.filter((w) => w.threshold === 0.8).length;
  }
  assert.equal(warned, 1, "soft threshold should alert exactly once");
});

test("rules with unmet scope value are skipped", () => {
  const policy: Policy = { limits: [{ scope: "org", metric: "requests", limit: 1, window: "minute" }] };
  const rules = applicableRules(policy, { model: "gpt-4o", userId: "u1" }, now); // no orgId
  assert.equal(rules.length, 0);
});
