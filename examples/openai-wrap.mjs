// Wrap an OpenAI call: enforce a per-user daily budget, record real usage.
// Run: node examples/openai-wrap.mjs   (after `npm run build`)
import OpenAI from "openai";
import { RateLimiter, consoleAlert } from "ai-rate-limiter";

const client = new OpenAI();

const limiter = new RateLimiter({
  policy: {
    limits: [
      { scope: "user", metric: "cost", limit: 5, window: "day", warnAt: [0.8] },
      { scope: "user", metric: "requests", limit: 60, window: "minute" },
    ],
  },
  alerts: [consoleAlert()],
});

async function chat(userId, messages) {
  return limiter.wrap(
    { provider: "openai", model: "gpt-4o", userId, route: "/chat", input: { messages } },
    () => client.chat.completions.create({ model: "gpt-4o", messages }),
  );
}

const res = await chat("alice", [{ role: "user", content: "Explain rate limiting in one line." }]);
console.log(res.choices[0].message.content);
