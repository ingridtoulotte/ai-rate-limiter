// Core type definitions for ai-rate-limiter.

export type Metric = "requests" | "tokens" | "cost";
export type WindowName = "minute" | "hour" | "day" | "month";
/** A named calendar/rolling window, or a raw number of milliseconds. */
export type Window = WindowName | number;
export type Scope = "global" | "user" | "org" | "project" | "model" | "route";

/** USD per 1,000,000 tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  /** optional discounted rate for cached input tokens */
  cachedInput?: number;
}
export type PricingTable = Record<string, ModelPricing>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** subset of inputTokens served from cache (billed at cachedInput rate) */
  cachedInputTokens?: number;
}

export interface CostEstimate {
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD: number;
  /** false when the model is not in the pricing table — cost is tracked as $0 and flagged */
  pricingKnown: boolean;
}

export interface MatchSpec {
  provider?: string | string[];
  model?: string | string[];
  route?: string | string[];
  userId?: string | string[];
  orgId?: string | string[];
  projectId?: string | string[];
}

export interface LimitRule {
  /** stable identifier; auto-derived when omitted */
  name?: string;
  scope: Scope;
  metric: Metric;
  /** limit in metric units: count for requests/tokens, USD for cost */
  limit: number;
  window: Window;
  /** soft thresholds as fractions of the limit, e.g. [0.8, 0.95] -> warning alerts */
  warnAt?: number[];
  /** only apply when the request matches these fields */
  match?: MatchSpec;
}

export interface Policy {
  limits: LimitRule[];
  /** assumed output tokens when a request does not declare maxOutputTokens (estimate only) */
  defaultMaxOutputTokens?: number;
  /** pricing overrides merged over DEFAULT_PRICING */
  pricing?: PricingTable;
}

export interface RequestContext {
  provider?: string;
  model: string;
  userId?: string;
  orgId?: string;
  projectId?: string;
  route?: string;
  /** raw request body (messages/prompt) for token estimation */
  input?: unknown;
  /** explicit input token count, used verbatim if provided */
  inputTokens?: number;
  /** expected output tokens for the pre-flight estimate */
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface Warning {
  rule: string;
  scope: Scope;
  metric: Metric;
  key: string;
  /** fraction threshold that was crossed (1 == hard limit, monitor mode) */
  threshold: number;
  used: number;
  limit: number;
  ratio: number;
}

export interface LimitHit {
  rule: string;
  scope: Scope;
  metric: Metric;
  key: string;
  used: number;
  limit: number;
  attempted: number;
  resetAt: number;
}

export interface ReservationEntry {
  key: string;
  amount: number;
  ttlMs: number;
  metric: Metric;
}
export interface Reservation {
  entries: ReservationEntry[];
  ctx: RequestContext;
  estimate: CostEstimate;
}

export interface AllowedDecision {
  allowed: true;
  estimate: CostEstimate;
  warnings: Warning[];
  reservation: Reservation;
}
export interface DeniedDecision {
  allowed: false;
  reason: string;
  retryAfterMs: number;
  limit: LimitHit;
  estimate: CostEstimate;
  warnings: Warning[];
  reservation: null;
}
export type Decision = AllowedDecision | DeniedDecision;

export interface UsageEntry {
  ts: number;
  provider?: string;
  model: string;
  userId?: string;
  orgId?: string;
  projectId?: string;
  route?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD: number;
  pricingKnown: boolean;
}

export type AlertEvent =
  | { type: "warning"; warning: Warning; ctx: RequestContext }
  | { type: "limit_exceeded"; limit: LimitHit; ctx: RequestContext }
  | { type: "recorded"; entry: UsageEntry };

export type AlertHook = (event: AlertEvent) => void | Promise<void>;

export interface Store {
  /** atomically add amount (may be negative) to a counter, (re)set ttl, return the new total */
  incrBy(key: string, amount: number, ttlMs: number): Promise<number>;
  /** read the current counter value (0 if missing/expired) */
  get(key: string): Promise<number>;
  /** persist a usage entry for reporting (optional) */
  pushUsage?(entry: UsageEntry): Promise<void>;
  /** recent usage entries for status/report (optional) */
  recentUsage?(limit?: number): Promise<UsageEntry[]>;
}

export interface Recorder {
  record(entry: UsageEntry): void | Promise<void>;
}
