import type { UsageEntry, Policy, LimitRule, Scope, MatchSpec } from "./types.js";
import { windowInfo, windowLabel } from "./window.js";

const NO_COLOR = !!process.env.NO_COLOR;
const paint = (code: string, s: string) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const dim = (s: string) => paint("2", s);
const bold = (s: string) => paint("1", s);
const red = (s: string) => paint("31", s);
const yellow = (s: string) => paint("33", s);
const green = (s: string) => paint("32", s);
const cyan = (s: string) => paint("36", s);

const W = 64;

export function money(n: number): string {
  if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 10) return "$" + n.toFixed(2);
  return "$" + n.toFixed(4);
}
export function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

/** Colored progress bar for a 0..1+ ratio. */
export function bar(ratio: number, width = 22): string {
  const r = Math.max(0, ratio);
  const filled = Math.min(width, Math.round(Math.min(1, r) * width));
  const fill = "█".repeat(filled) + "░".repeat(width - filled);
  const col = r >= 1 ? red : r >= 0.8 ? yellow : green;
  return col(fill);
}

export interface ReportAgg {
  total: { requests: number; inputTokens: number; outputTokens: number; cost: number };
  byUser: Map<string, number>;
  byModel: Map<string, { cost: number; requests: number; tokens: number }>;
  byRoute: Map<string, number>;
  unknownPricing: number;
  windowStart: number;
  windowEnd: number;
}

function scopeOf(scope: Scope, e: UsageEntry): string | undefined {
  switch (scope) {
    case "global": return "global";
    case "user": return e.userId;
    case "org": return e.orgId;
    case "project": return e.projectId;
    case "model": return e.model;
    case "route": return e.route;
  }
}
function matchOne(spec: string | string[] | undefined, v: string | undefined): boolean {
  if (spec === undefined) return true;
  if (v === undefined) return false;
  return Array.isArray(spec) ? spec.includes(v) : spec === v;
}
function matchesEntry(m: MatchSpec | undefined, e: UsageEntry): boolean {
  if (!m) return true;
  return matchOne(m.provider, e.provider) && matchOne(m.model, e.model) && matchOne(m.route, e.route) &&
    matchOne(m.userId, e.userId) && matchOne(m.orgId, e.orgId) && matchOne(m.projectId, e.projectId);
}

export function aggregate(entries: UsageEntry[], since?: number, until?: number): ReportAgg {
  const agg: ReportAgg = {
    total: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    byUser: new Map(), byModel: new Map(), byRoute: new Map(),
    unknownPricing: 0, windowStart: Infinity, windowEnd: 0,
  };
  for (const e of entries) {
    if (since !== undefined && e.ts < since) continue;
    if (until !== undefined && e.ts > until) continue;
    agg.total.requests += 1;
    agg.total.inputTokens += e.inputTokens;
    agg.total.outputTokens += e.outputTokens;
    agg.total.cost += e.costUSD;
    if (!e.pricingKnown) agg.unknownPricing += 1;
    agg.windowStart = Math.min(agg.windowStart, e.ts);
    agg.windowEnd = Math.max(agg.windowEnd, e.ts);
    if (e.userId) agg.byUser.set(e.userId, (agg.byUser.get(e.userId) ?? 0) + e.costUSD);
    if (e.route) agg.byRoute.set(e.route, (agg.byRoute.get(e.route) ?? 0) + e.costUSD);
    const m = agg.byModel.get(e.model) ?? { cost: 0, requests: 0, tokens: 0 };
    m.cost += e.costUSD; m.requests += 1; m.tokens += e.totalTokens;
    agg.byModel.set(e.model, m);
  }
  if (agg.windowStart === Infinity) agg.windowStart = 0;
  return agg;
}

export interface Budget { label: string; scope: Scope; key: string; window: string; used: number; limit: number; }

/** Build cost-budget bars from policy: for each cost rule, the most-utilized key in its window. */
export function budgetsFromPolicy(policy: Policy, entries: UsageEntry[], now: number): Budget[] {
  const out: Budget[] = [];
  policy.limits.forEach((rule: LimitRule) => {
    if (rule.metric !== "cost") return;
    const wi = windowInfo(rule.window, now);
    const since = wi.resetAt - wi.windowMs;
    const usageByKey = new Map<string, number>();
    for (const e of entries) {
      if (e.ts < since) continue;
      if (!matchesEntry(rule.match, e)) continue;
      const k = scopeOf(rule.scope, e);
      if (k === undefined) continue;
      usageByKey.set(k, (usageByKey.get(k) ?? 0) + e.costUSD);
    }
    let topKey: string | undefined;
    let top = -1;
    for (const [k, v] of usageByKey) if (v > top) { top = v; topKey = k; }
    if (topKey === undefined) { topKey = rule.scope === "global" ? "global" : "(none)"; top = 0; }
    out.push({
      label: rule.name ?? `${rule.scope} ${rule.metric}`,
      scope: rule.scope, key: topKey, window: windowLabel(rule.window),
      used: Math.max(0, top), limit: rule.limit,
    });
  });
  return out;
}

function line(s = ""): string { return s; }
function rule(): string { return dim("─".repeat(W)); }
function section(title: string): string { return bold(cyan(title)); }

/**
 * Render the screenshot-worthy budget board from raw usage entries + policy.
 * options.window restricts the spend summary (default: last 24h).
 */
export function renderReport(
  entries: UsageEntry[],
  policy: Policy,
  now: number = Date.now(),
  opts: { windowMs?: number; title?: string } = {},
): string {
  const windowMs = opts.windowMs ?? 24 * 3600_000;
  const since = now - windowMs;
  const agg = aggregate(entries, since, now);
  const budgets = budgetsFromPolicy(policy, entries, now);
  // Leaderboards use month-to-date so they line up with the monthly budgets above.
  const monthWin = windowInfo("month", now);
  const monthStart = monthWin.resetAt - monthWin.windowMs;
  const monthAgg = aggregate(entries, monthStart, now);
  const dayRate = agg.total.cost / (windowMs / 86400_000 || 1);
  const projectedMonth = dayRate * (monthWin.windowMs / 86400_000);
  const out: string[] = [];

  const ts = new Date(now).toISOString().slice(0, 16).replace("T", " ");
  out.push(rule());
  out.push(bold("  ai-rate-limiter") + dim("  ·  Budget Status") + dim("        " + ts + " UTC"));
  out.push(rule());

  if (budgets.length) {
    out.push(section("  BUDGETS"));
    for (const b of budgets) {
      const ratio = b.limit > 0 ? b.used / b.limit : 0;
      const pct = (ratio * 100).toFixed(0).padStart(3) + "%";
      const flag = ratio >= 1 ? red("  OVER") : ratio >= 0.8 ? yellow("  ⚠") : "";
      const head = `  ${b.label} ${dim(b.scope + "=" + b.key)} ${dim("/ " + b.window)}`;
      out.push(head);
      out.push(`    ${bar(ratio)} ${pct}  ${money(b.used)} / ${money(b.limit)}${flag}`);
    }
    out.push(line());
  }

  out.push(section(`  SPEND (last ${Math.round(windowMs / 3600_000)}h)`));
  out.push(`    requests ${bold(compact(agg.total.requests))}   tokens ${bold(compact(agg.total.inputTokens))} in / ${bold(compact(agg.total.outputTokens))} out`);
  out.push(`    est cost ${bold(money(agg.total.cost))}   ${dim("projected month ≈ " + money(projectedMonth))}`);
  if (agg.unknownPricing > 0) out.push(`    ${yellow("note")} ${agg.unknownPricing} request(s) on unpriced models (counted at $0)`);
  out.push(line());

  const users = [...monthAgg.byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (users.length) {
    const max = users[0]![1] || 1;
    out.push(section("  TOP SPENDERS (month-to-date)"));
    users.forEach(([u, v], i) => {
      out.push(`    ${dim(String(i + 1) + ".")} ${u.padEnd(14)} ${money(v).padStart(9)}  ${bar(v / max, 14)}`);
    });
    out.push(line());
  }

  const models = [...monthAgg.byModel.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 6);
  if (models.length) {
    const totalCost = monthAgg.total.cost || 1;
    out.push(section("  MODEL BREAKDOWN (month-to-date)"));
    for (const [m, v] of models) {
      const share = ((v.cost / totalCost) * 100).toFixed(0).padStart(3) + "%";
      out.push(`    ${m.padEnd(20)} ${money(v.cost).padStart(9)}  ${share}  ${dim(compact(v.tokens) + " tok")}`);
    }
    out.push(line());
  }

  const routes = [...monthAgg.byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (routes.length) {
    out.push(section("  ROUTE BREAKDOWN (month-to-date)"));
    for (const [r, v] of routes) out.push(`    ${r.padEnd(24)} ${money(v).padStart(9)}`);
    out.push(line());
  }

  out.push(rule());
  return out.join("\n");
}
