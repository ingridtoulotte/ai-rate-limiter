import type { DeniedDecision } from "./types.js";

/** Thrown by guard()/wrap() when a request is rejected by policy. */
export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";
  readonly decision: DeniedDecision;
  readonly retryAfterMs: number;
  constructor(message: string, decision: DeniedDecision) {
    super(message);
    this.name = "BudgetExceededError";
    this.decision = decision;
    this.retryAfterMs = decision.retryAfterMs;
  }
}

/** Wraps a backend store failure. */
export class StoreError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StoreError";
    this.cause = cause;
  }
}
