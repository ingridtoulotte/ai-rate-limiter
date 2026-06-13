import type {
  Policy, RequestContext, Store, Decision, AllowedDecision, DeniedDecision,
  AlertHook, AlertEvent, PricingTable, Recorder, UsageEntry, TokenUsage,
  Reservation, CostEstimate,
} from "./types.js";
import { MemoryStore } from "./stores/memory.js";
import { estimateCost, costFromUsage } from "./estimate.js";
import { evaluate, reconcile, release, recordFresh } from "./policy.js";
import { normalizeUsage } from "./providers/index.js";
import { BudgetExceededError, StoreError } from "./errors.js";

export type Mode = "enforce" | "monitor";
export type FailMode = "open" | "closed";

export interface RateLimiterOptions {
  policy: Policy;
  store?: Store;
  pricing?: PricingTable;
  alerts?: AlertHook[];
  recorder?: Recorder;
  /** enforce = deny over-limit requests; monitor = record + warn, never deny */
  mode?: Mode;
  /** behavior when the store is unreachable: open = allow, closed = deny */
  failMode?: FailMode;
  /** clock override (testing) */
  clock?: () => number;
}

/**
 * The control plane. Wrap LLM calls, enforce budgets and rate limits, record
 * real usage, and emit alerts — across any provider.
 */
export class RateLimiter {
  readonly store: Store;
  private policy: Policy;
  private pricing?: PricingTable;
  private alerts: AlertHook[];
  private recorder?: Recorder;
  private mode: Mode;
  private failMode: FailMode;
  private now: () => number;

  constructor(opts: RateLimiterOptions) {
    this.policy = opts.policy;
    this.store = opts.store ?? new MemoryStore();
    this.pricing = opts.pricing ?? opts.policy.pricing;
    this.alerts = opts.alerts ?? [];
    this.recorder = opts.recorder;
    this.mode = opts.mode ?? "enforce";
    this.failMode = opts.failMode ?? "open";
    this.now = opts.clock ?? Date.now;
  }

  /** Pre-flight cost estimate for a request (no side effects). */
  estimate(ctx: RequestContext): CostEstimate {
    return estimateCost(ctx, this.pricing, this.policy.defaultMaxOutputTokens);
  }

  /**
   * Check a request against policy. Returns a Decision; when allowed, the
   * decision carries a reservation to pass back to record().
   */
  async check(ctx: RequestContext): Promise<Decision> {
    const now = this.now();
    const est = this.estimate(ctx);
    let decision: Decision;
    try {
      decision = await evaluate(this.store, this.policy, ctx, est, now, this.mode === "enforce");
    } catch (err) {
      return this.onStoreFailure(ctx, est, now, err);
    }
    if (decision.warnings.length) {
      for (const w of decision.warnings) await this.emit({ type: "warning", warning: w, ctx });
    }
    if (!decision.allowed) await this.emit({ type: "limit_exceeded", limit: decision.limit, ctx });
    return decision;
  }

  /**
   * Record actual usage. Pass the reservation from check() to reconcile the
   * estimate to real token counts/cost; omit it for standalone logging.
   */
  async record(ctx: RequestContext, usage: TokenUsage, reservation?: Reservation | null): Promise<UsageEntry> {
    const now = this.now();
    const actual = costFromUsage(ctx.model, usage, this.pricing, ctx.provider);
    try {
      if (reservation && reservation.entries.length) await reconcile(this.store, reservation, actual);
      else if (!reservation) await recordFresh(this.store, this.policy, ctx, actual, now);
    } catch (err) {
      console.error("[ai-rate-limiter] reconcile failed:", (err as Error).message);
    }
    const entry: UsageEntry = {
      ts: now,
      provider: ctx.provider ?? actual.provider,
      model: ctx.model,
      userId: ctx.userId,
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      route: ctx.route,
      inputTokens: actual.inputTokens,
      outputTokens: actual.outputTokens,
      totalTokens: actual.totalTokens,
      costUSD: actual.costUSD,
      pricingKnown: actual.pricingKnown,
    };
    try { await this.store.pushUsage?.(entry); } catch { /* non-fatal */ }
    try { await this.recorder?.record(entry); } catch (err) { console.error("[ai-rate-limiter] recorder failed:", (err as Error).message); }
    await this.emit({ type: "recorded", entry });
    return entry;
  }

  /** Like check(), but throws BudgetExceededError when denied. */
  async guard(ctx: RequestContext): Promise<AllowedDecision> {
    const d = await this.check(ctx);
    if (!d.allowed) throw new BudgetExceededError(d.reason, d as DeniedDecision);
    return d;
  }

  /**
   * One-call integration: enforce budget, run the provider call, record real
   * usage from the response. Throws BudgetExceededError before the call if the
   * request is over limit. On call failure the reservation is released.
   */
  async wrap<T>(
    ctx: RequestContext,
    fn: () => Promise<T>,
    extractUsage?: (result: T) => TokenUsage | undefined,
  ): Promise<T> {
    const decision = await this.guard(ctx);
    let result: T;
    try {
      result = await fn();
    } catch (err) {
      try { await release(this.store, decision.reservation); } catch { /* ignore */ }
      throw err;
    }
    const usage = extractUsage ? extractUsage(result) : normalizeUsage(result, ctx.provider, ctx.model);
    if (usage) await this.record(ctx, usage, decision.reservation);
    else await this.record(ctx, { inputTokens: decision.estimate.inputTokens, outputTokens: decision.estimate.outputTokens }, decision.reservation);
    return result;
  }

  private async onStoreFailure(ctx: RequestContext, est: CostEstimate, now: number, err: unknown): Promise<Decision> {
    const e = new StoreError("store failure during check", err);
    if (this.failMode === "closed") {
      return {
        allowed: false,
        reason: "store unavailable (fail-closed)",
        retryAfterMs: 1000,
        limit: { rule: "store", scope: "global", metric: "requests", key: "global", used: 0, limit: 0, attempted: 1, resetAt: now + 1000 },
        estimate: est,
        warnings: [],
        reservation: null,
      };
    }
    console.error("[ai-rate-limiter] " + e.message + " — failing open:", (err as Error)?.message);
    return { allowed: true, estimate: est, warnings: [], reservation: { entries: [], ctx, estimate: est } };
  }

  private async emit(event: AlertEvent): Promise<void> {
    for (const hook of this.alerts) {
      try { await hook(event); } catch (err) { console.error("[ai-rate-limiter] alert hook error:", (err as Error).message); }
    }
  }
}
