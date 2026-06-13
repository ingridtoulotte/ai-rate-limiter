import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, aggregate, budgetsFromPolicy } from "../src/report.js";
import type { UsageEntry, Policy } from "../src/types.js";

const now = Date.UTC(2026, 5, 14, 12, 0, 0);
function mk(over: Partial<UsageEntry>): UsageEntry {
  return { ts: now - 3600_000, model: "gpt-4o", userId: "alice", orgId: "acme", route: "/v1/chat", inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUSD: 0.0075, pricingKnown: true, ...over };
}

test("aggregate sums totals and groups", () => {
  const entries = [mk({}), mk({ userId: "bob", costUSD: 0.02 }), mk({ model: "claude-sonnet-4", costUSD: 0.05 })];
  const agg = aggregate(entries, now - 86400_000, now);
  assert.equal(agg.total.requests, 3);
  assert.ok(Math.abs(agg.total.cost - 0.0775) < 1e-9);
  assert.equal(agg.byUser.get("alice")! > 0, true);
});

test("budgetsFromPolicy reports most-utilized key per cost rule", () => {
  const policy: Policy = { limits: [{ name: "user-budget", scope: "user", metric: "cost", limit: 1, window: "day" }] };
  const entries = [mk({ userId: "alice", costUSD: 0.5 }), mk({ userId: "bob", costUSD: 0.1 })];
  const budgets = budgetsFromPolicy(policy, entries, now);
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0]!.key, "alice");
  assert.ok(Math.abs(budgets[0]!.used - 0.5) < 1e-9);
});

test("renderReport produces a board with the headline sections", () => {
  const policy: Policy = { limits: [{ name: "user-budget", scope: "user", metric: "cost", limit: 1, window: "month" }] };
  const out = renderReport([mk({}), mk({ userId: "bob" })], policy, now);
  for (const token of ["ai-rate-limiter", "BUDGETS", "SPEND", "TOP SPENDERS", "MODEL BREAKDOWN"]) {
    assert.ok(out.includes(token), `report should include ${token}`);
  }
});
