// Drop-in Express middleware: reject over-budget tenants with HTTP 429.
import express from "express";
import { RateLimiter, BudgetExceededError } from "ai-rate-limiter";

const limiter = new RateLimiter({
  policy: {
    limits: [
      { scope: "org", metric: "cost", limit: 1000, window: "month", warnAt: [0.8] },
      { scope: "user", metric: "requests", limit: 30, window: "minute" },
    ],
  },
});

const app = express();
app.use(express.json());

// Attach budget enforcement to any LLM route.
function budget(getCtx) {
  return async (req, res, next) => {
    try {
      const decision = await limiter.guard(getCtx(req));
      req.arl = decision;            // reservation for record() after the call
      next();
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        res.set("Retry-After", Math.ceil(err.retryAfterMs / 1000));
        return res.status(429).json({ error: "budget_exceeded", reason: err.message, retryAfterMs: err.retryAfterMs });
      }
      next(err);
    }
  };
}

app.post(
  "/v1/chat",
  budget((req) => ({ model: "gpt-4o", userId: req.headers["x-user-id"], orgId: req.headers["x-org-id"], route: "/v1/chat", input: req.body })),
  async (req, res) => {
    const result = await callYourLLM(req.body);          // your provider call
    await limiter.record(
      { model: "gpt-4o", userId: req.headers["x-user-id"], orgId: req.headers["x-org-id"], route: "/v1/chat" },
      { inputTokens: result.usage.prompt_tokens, outputTokens: result.usage.completion_tokens },
      req.arl.reservation,
    );
    res.json(result);
  },
);

app.listen(3000);
