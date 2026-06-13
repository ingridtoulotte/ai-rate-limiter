import { test } from "node:test";
import assert from "node:assert/strict";
import { windowInfo } from "../src/window.js";

test("minute window resets on the next 60s boundary", () => {
  const now = 1_700_000_123_456;
  const w = windowInfo("minute", now);
  assert.equal(w.windowMs, 60_000);
  assert.equal(w.resetAt % 60_000, 0);
  assert.ok(w.resetAt > now && w.resetAt - now <= 60_000);
});

test("day window is a 24h UTC window", () => {
  const w = windowInfo("day", Date.UTC(2026, 5, 14, 9, 30));
  assert.equal(w.windowMs, 86_400_000);
  assert.equal(w.resetAt, Date.UTC(2026, 5, 15));
});

test("numeric window is a fixed ms window", () => {
  const w = windowInfo(5000, 12_345);
  assert.equal(w.windowMs, 5000);
  assert.equal(w.resetAt, 15_000);
});

test("month window resets at next month start (UTC)", () => {
  const w = windowInfo("month", Date.UTC(2026, 5, 14));
  assert.equal(w.resetAt, Date.UTC(2026, 6, 1));
});
