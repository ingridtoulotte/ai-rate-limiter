// Wrap a Claude call. Usage (input/output tokens) is read straight from the
// Anthropic response, so cost tracking is exact — not estimated.
import Anthropic from "@anthropic-ai/sdk";
import { RateLimiter } from "ai-rate-limiter";

const client = new Anthropic();
const limiter = new RateLimiter({
  policy: { limits: [{ scope: "org", metric: "cost", limit: 500, window: "month", warnAt: [0.8, 0.95] }] },
});

async function ask(orgId, userId, prompt) {
  return limiter.wrap(
    { provider: "anthropic", model: "claude-sonnet-4", orgId, userId, input: { messages: [{ role: "user", content: prompt }] } },
    () => client.messages.create({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  );
}

const msg = await ask("acme", "alice", "Give me a haiku about budgets.");
console.log(msg.content[0].text);
