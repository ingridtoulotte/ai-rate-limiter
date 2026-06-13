import type {
  Policy, RequestContext, Store, CostEstimate, Decision, Warning, LimitHit,
  LimitRule, Metric, Reservation, ReservationEntry, MatchSpec,
} from "./types.js";
import { windowInfo } from "./window.js";

/** Convert a metric value to its integer base unit (cost -> micro-USD). */
export function toBase(metric: Metric, value: number): number {
  return metric === "cost" ? Math.round(value * 1e6) : Math.round(value);
}
export function fromBase(metric: Metric, value: number): number {
  return metric === "cost" ? value / 1e6 : value;
}

function amountForMetric(metric: Metric, est: CostEstimate): number {
  switch (metric) {
    case "requests": return 1;
    case "tokens": return toBase("tokens", est.totalTokens);
    case "cost": return toBase("cost", est.costUSD);
  }
}

function matchField(spec: string | string[] | undefined, value: string | undefined): boolean {
  if (spec === undefined) return true;
  if (value === undefined) return false;
  return Array.isArray(spec) ? spec.includes(value) : spec === value;
}

function matches(match: MatchSpec | undefined, ctx: RequestContext): boolean {
  if (!match) return true;
  return (
    matchField(match.provider, ctx.provider) &&
    matchField(match.model, ctx.model) &&
    matchField(match.route, ctx.route) &&
    matchField(match.userId, ctx.userId) &&
    matchField(match.orgId, ctx.orgId) &&
    matchField(match.projectId, ctx.projectId)
  );
}

function scopeValue(scope: LimitRule["scope"], ctx: RequestContext): string | undefined {
  switch (scope) {
    case "global": return "global";
    case "user": return ctx.userId;
    case "org": return ctx.orgId;
    case "project": return ctx.projectId;
    case "model": return ctx.model;
    case "route": return ctx.route;
  }
}

export function ruleName(r: LimitRule, i: number): string {
  if (r.name) return r.name;
  const win = typeof r.window === "number" ? `${r.window}ms` : r.window;
  return `${r.scope}.${r.metric}.${win}#${i}`;
}

export interface ApplicableRule {
  rule: LimitRule;
  name: string;
  key: string;
  resetAt: number;
  windowMs: number;
  scopeVal: string;
}

/** All rules that apply to this request (matched + scope value present). */
export function applicableRules(policy: Policy, ctx: RequestContext, now: number): ApplicableRule[] {
  const out: ApplicableRule[] = [];
  policy.limits.forEach((rule, i) => {
    if (!matches(rule.match, ctx)) return;
    const sv = scopeValue(rule.scope, ctx);
    if (sv === undefined) return; // cannot enforce a scope whose value was not supplied
    const wi = windowInfo(rule.window, now);
    const name = ruleName(rule, i);
    const key = `${name}:${rule.scope}:${sv}:${rule.metric}:${wi.bucket}`;
    out.push({ rule, name, key, resetAt: wi.resetAt, windowMs: wi.windowMs, scopeVal: sv });
  });
  return out;
}

/**
 * Two-phase enforcement: reserve the estimated amount against every applicable
 * counter. If any limit would be exceeded, roll back all reservations and deny
 * (enforce mode). In monitor mode counters keep climbing and breaches surface
 * as warnings instead of denials.
 */
export async function evaluate(
  store: Store,
  policy: Policy,
  ctx: RequestContext,
  est: CostEstimate,
  now: number,
  enforce: boolean,
): Promise<Decision> {
  const rules = applicableRules(policy, ctx, now);
  const reserved: ReservationEntry[] = [];
  const warnings: Warning[] = [];

  for (const ar of rules) {
    const { rule } = ar;
    const amount = amountForMetric(rule.metric, est);
    const limitBase = toBase(rule.metric, rule.limit);
    const ttl = ar.windowMs + 60_000;
    const total = await store.incrBy(ar.key, amount, ttl);

    if (total > limitBase) {
      const hit: LimitHit = {
        rule: ar.name,
        scope: rule.scope,
        metric: rule.metric,
        key: ar.scopeVal,
        used: fromBase(rule.metric, total - amount),
        limit: rule.limit,
        attempted: fromBase(rule.metric, amount),
        resetAt: ar.resetAt,
      };
      if (enforce) {
        await store.incrBy(ar.key, -amount, ttl);
        for (const e of reserved) await store.incrBy(e.key, -e.amount, e.ttlMs);
        return {
          allowed: false,
          reason: `${rule.metric} limit exceeded for ${rule.scope}=${ar.scopeVal} (rule ${ar.name})`,
          retryAfterMs: Math.max(0, ar.resetAt - now),
          limit: hit,
          estimate: est,
          warnings,
          reservation: null,
        };
      }
      warnings.push({
        rule: ar.name, scope: rule.scope, metric: rule.metric, key: ar.scopeVal,
        threshold: 1, used: fromBase(rule.metric, total), limit: rule.limit,
        ratio: limitBase > 0 ? total / limitBase : Infinity,
      });
    }

    reserved.push({ key: ar.key, amount, ttlMs: ttl, metric: rule.metric });

    if (rule.warnAt && limitBase > 0) {
      const prev = total - amount;
      for (const th of rule.warnAt) {
        if (total / limitBase >= th && prev / limitBase < th) {
          warnings.push({
            rule: ar.name, scope: rule.scope, metric: rule.metric, key: ar.scopeVal,
            threshold: th, used: fromBase(rule.metric, total), limit: rule.limit,
            ratio: total / limitBase,
          });
        }
      }
    }
  }

  const reservation: Reservation = { entries: reserved, ctx, estimate: est };
  return { allowed: true, estimate: est, warnings, reservation };
}

/** Adjust reserved counters to actual usage after the request completes. */
export async function reconcile(store: Store, reservation: Reservation, actual: CostEstimate): Promise<void> {
  for (const e of reservation.entries) {
    const actualBase = e.metric === "requests" ? e.amount : amountForMetric(e.metric, actual);
    const delta = actualBase - e.amount;
    if (delta !== 0) await store.incrBy(e.key, delta, e.ttlMs);
  }
}

/** Release a reservation entirely (request failed before producing usage). */
export async function release(store: Store, reservation: Reservation): Promise<void> {
  for (const e of reservation.entries) {
    if (e.amount !== 0) await store.incrBy(e.key, -e.amount, e.ttlMs);
  }
}

/** Increment counters by actual usage with no prior reservation (manual record). */
export async function recordFresh(store: Store, policy: Policy, ctx: RequestContext, actual: CostEstimate, now: number): Promise<void> {
  const rules = applicableRules(policy, ctx, now);
  for (const ar of rules) {
    const amount = amountForMetric(ar.rule.metric, actual);
    if (amount !== 0) await store.incrBy(ar.key, amount, ar.windowMs + 60_000);
  }
}
