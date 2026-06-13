#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { renderReport } from "./report.js";
import { DEFAULT_PRICING } from "./pricing.js";
import { loadConfig, createLimiter } from "./config.js";
import type { UsageEntry, Policy, RequestContext } from "./types.js";

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true";
      out[k] = v;
    }
  }
  return out;
}

// ---- demo data (deterministic, for screenshots) ----
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff; }

const DEMO_POLICY: Policy = {
  limits: [
    { name: "org-monthly-budget", scope: "org", metric: "cost", limit: 200, window: "month", warnAt: [0.8, 0.95] },
    { name: "user-monthly-budget", scope: "user", metric: "cost", limit: 120, window: "month", warnAt: [0.8] },
    { name: "global-daily-budget", scope: "global", metric: "cost", limit: 13, window: "day", warnAt: [0.8] },
    { name: "user-rpm", scope: "user", metric: "requests", limit: 60, window: "minute" },
    { name: "user-tpm", scope: "user", metric: "tokens", limit: 200_000, window: "minute" },
  ],
};

function demoEntries(now: number): UsageEntry[] {
  const rnd = lcg(42);
  const users = [
    { id: "alice", w: 5 }, { id: "bob", w: 3 }, { id: "carol", w: 2 }, { id: "dave", w: 1 },
  ];
  const models = [
    { id: "claude-sonnet-4", inP: 3, outP: 15 },
    { id: "gpt-4o", inP: 2.5, outP: 10 },
    { id: "gpt-4o-mini", inP: 0.15, outP: 0.6 },
    { id: "gemini-2.5-flash", inP: 0.3, outP: 2.5 },
  ];
  const routes = ["/v1/chat", "/v1/summarize", "/v1/agent", "/v1/embed"];
  const entries: UsageEntry[] = [];
  const span = 30 * 24 * 3600_000;
  const count = 48_000;
  for (let i = 0; i < count; i++) {
    const u = users[Math.floor(rnd() * rnd() * users.length)] ?? users[0]!;
    const m = models[Math.floor(rnd() * models.length)]!;
    const route = routes[Math.floor(rnd() * routes.length)]!;
    const inTok = Math.round(300 + rnd() * 4000);
    const outTok = Math.round(80 + rnd() * 1200);
    const cost = (inTok * m.inP + outTok * m.outP) / 1e6;
    entries.push({
      ts: now - Math.floor(rnd() * span),
      provider: undefined, model: m.id, userId: u.id, orgId: "acme", route,
      inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok,
      costUSD: cost, pricingKnown: true,
    });
  }
  return entries;
}

function readUsageFile(path: string): UsageEntry[] {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  if (raw[0] === "[") return JSON.parse(raw) as UsageEntry[];
  return raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as UsageEntry);
}

async function cmdSimulate() {
  const now = Date.now();
  console.log(renderReport(demoEntries(now), DEMO_POLICY, now));
}

async function cmdReport(file: string | undefined, flags: Record<string, string>) {
  if (!file) { console.error("usage: arl report <usage.jsonl> [--config <file>] [--hours N]"); process.exit(1); }
  const entries = readUsageFile(file);
  let policy: Policy = DEMO_POLICY;
  if (flags.config) policy = (await loadConfig(flags.config)).policy;
  const windowMs = flags.hours ? Number(flags.hours) * 3600_000 : undefined;
  console.log(renderReport(entries, policy, Date.now(), { windowMs }));
}

async function cmdCheck(flags: Record<string, string>) {
  if (!flags.config) { console.error("usage: arl check --config <file> --model <id> [--user U] [--org O] [--route R] [--input-tokens N] [--max-output N]"); process.exit(1); }
  const cfg = await loadConfig(flags.config);
  const rl = createLimiter(cfg);
  const ctx: RequestContext = {
    model: flags.model ?? "gpt-4o",
    userId: flags.user, orgId: flags.org, projectId: flags.project, route: flags.route,
    inputTokens: flags["input-tokens"] ? Number(flags["input-tokens"]) : undefined,
    maxOutputTokens: flags["max-output"] ? Number(flags["max-output"]) : undefined,
  };
  const d = await rl.check(ctx);
  const est = d.estimate;
  console.log(`model        ${est.model}${est.pricingKnown ? "" : "  (unpriced)"}`);
  console.log(`est tokens   ${est.inputTokens} in / ${est.outputTokens} out`);
  console.log(`est cost     $${est.costUSD.toFixed(6)}`);
  console.log(`decision     ${d.allowed ? "ALLOW" : "DENY"}`);
  if (!d.allowed) {
    console.log(`reason       ${d.reason}`);
    console.log(`retry after  ${Math.round(d.retryAfterMs / 1000)}s`);
  }
  for (const w of d.warnings) console.log(`warning      ${w.rule} ${w.scope}=${w.key} at ${(w.ratio * 100).toFixed(0)}%`);
  process.exit(d.allowed ? 0 : 2);
}

function cmdPricing() {
  console.log("model".padEnd(22) + "input/M".padStart(10) + "output/M".padStart(11));
  for (const [m, p] of Object.entries(DEFAULT_PRICING)) {
    console.log(m.padEnd(22) + ("$" + p.input).padStart(10) + ("$" + p.output).padStart(11));
  }
}

function help() {
  console.log(`ai-rate-limiter (arl)

  arl simulate                 render a demo budget board (no setup)
  arl report <usage.jsonl>     render the board from recorded usage
       [--config f] [--hours N]
  arl check --config f --model m [--user U] [--org O] [--route R]
       [--input-tokens N] [--max-output N]
  arl pricing                  print the default price table
  arl help                     this help
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const positional = rest.filter((a) => !a.startsWith("--"));
  switch (cmd) {
    case "simulate": return cmdSimulate();
    case "report": return cmdReport(positional[0], flags);
    case "check": return cmdCheck(flags);
    case "pricing": return cmdPricing();
    case undefined:
    case "help":
    case "--help":
    case "-h": return help();
    default: console.error(`unknown command: ${cmd}`); help(); process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
