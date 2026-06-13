import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/limiter.js";
import { BudgetExceededError } from "../src/errors.js";
import type { Store } from "../src/types.js";

const clock = () => Date.UTC(2026, 5, 14, 12, 0, 0);

test("wrap enforces, runs, and records real usage", async () => {
  const rl = new RateLimiter({
    policy: { limits: [{ scope: "user", metric: "cost", limit: 10, window: "day" }] },
    clock,
  });
  const resp = { usage: { prompt_tokens: 1000, completion_tokens: 1000 } };
  const out = await rl.wrap({ model: "gpt-4o", userId: "u1" }, async () => resp);
  assert.equal(out, resp);
  const recent = await rl.store.recentUsage!();
  assert.equal(recent.length, 1);
  assert.equal(recent[0]!.inputTokens, 1000);
});

test("guard throws BudgetExceededError when over budget", async () => {
  const rl = new RateLimiter({
    policy: { limits: [{ scope: "user", metric: "cost", limit: 0.0001, window: "day" }] },
    clock,
  });
  await assert.rejects(
    () => rl.wrap({ model: "gpt-4o", userId: "u1", maxOutputTokens: 1000 }, async () => ({})),
    BudgetExceededError,
  );
});

test("monitor mode does not throw", async () => {
  const rl = new RateLimiter({
    policy: { limits: [{ scope: "user", metric: "cost", limit: 0.0001, window: "day" }] },
    mode: "monitor",
    clock,
  });
  const out = await rl.wrap({ model: "gpt-4o", userId: "u1" }, async () => ({ usage: { prompt_tokens: 5, completion_tokens: 5 } }));
  assert.ok(out);
});

test("failing store: fail-open allows, fail-closed denies", async () => {
  const broken: Store = {
    async incrBy() { throw new Error("redis down"); },
    async get() { return 0; },
  };
  const open = new RateLimiter({ policy: { limits: [{ scope: "user", metric: "requests", limit: 1, window: "minute" }] }, store: broken, failMode: "open", clock });
  const closed = new RateLimiter({ policy: { limits: [{ scope: "user", metric: "requests", limit: 1, window: "minute" }] }, store: broken, failMode: "closed", clock });
  assert.equal((await open.check({ model: "gpt-4o", userId: "u1" })).allowed, true);
  assert.equal((await closed.check({ model: "gpt-4o", userId: "u1" })).allowed, false);
});

test("alerts fire on limit exceeded", async () => {
  const events: string[] = [];
  const rl = new RateLimiter({
    policy: { limits: [{ scope: "user", metric: "requests", limit: 1, window: "minute" }] },
    alerts: [(e) => { events.push(e.type); }],
    clock,
  });
  await rl.check({ model: "gpt-4o", userId: "u1" });
  await rl.check({ model: "gpt-4o", userId: "u1" });
  assert.ok(events.includes("limit_exceeded"));
});
