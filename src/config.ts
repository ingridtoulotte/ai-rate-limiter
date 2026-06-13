import { readFileSync } from "node:fs";
import { resolve, extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { Policy, PricingTable, Store } from "./types.js";
import { RateLimiter, type Mode, type FailMode } from "./limiter.js";
import { MemoryStore } from "./stores/memory.js";
import { consoleAlert, webhookAlert } from "./alerts.js";

export interface FileConfig {
  policy: Policy;
  mode?: Mode;
  failMode?: FailMode;
  pricing?: PricingTable;
  storage?: { backend?: "memory" | "redis"; redisUrl?: string };
  alerts?: { console?: boolean; webhook?: string };
}

/** Load a config from .json, .yaml/.yml (needs optional js-yaml), or .js/.mjs (default export). */
export async function loadConfig(path: string): Promise<FileConfig> {
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const ext = extname(abs).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    const mod: any = await import(pathToFileURL(abs).href);
    return applyEnv(mod.default ?? mod.config ?? mod);
  }
  const raw = readFileSync(abs, "utf8");
  if (ext === ".yaml" || ext === ".yml") return applyEnv(await parseYaml(raw));
  return applyEnv(JSON.parse(raw));
}

async function parseYaml(raw: string): Promise<FileConfig> {
  try {
    // Indirect specifier so the optional dep is not a static type dependency.
    const spec = "js-yaml";
    const mod: any = await import(spec);
    const load = mod.load ?? mod.default?.load;
    return load(raw) as FileConfig;
  } catch {
    throw new Error("YAML config requires the optional 'js-yaml' package (npm i js-yaml) — or use JSON/JS config.");
  }
}

/** Environment variables override file config. */
export function applyEnv(cfg: FileConfig): FileConfig {
  if (process.env.ARL_MODE) cfg.mode = process.env.ARL_MODE as Mode;
  if (process.env.ARL_FAIL_MODE) cfg.failMode = process.env.ARL_FAIL_MODE as FailMode;
  if (process.env.ARL_REDIS_URL) cfg.storage = { backend: "redis", redisUrl: process.env.ARL_REDIS_URL };
  if (process.env.ARL_WEBHOOK) cfg.alerts = { ...(cfg.alerts ?? {}), webhook: process.env.ARL_WEBHOOK };
  return cfg;
}

/**
 * Build a RateLimiter from a loaded config. For Redis storage, inject a store
 * via opts.store (the library never imports a redis client itself).
 */
export function createLimiter(cfg: FileConfig, opts: { store?: Store } = {}): RateLimiter {
  const alerts = [];
  if (cfg.alerts?.console !== false) alerts.push(consoleAlert());
  if (cfg.alerts?.webhook) alerts.push(webhookAlert(cfg.alerts.webhook));
  return new RateLimiter({
    policy: cfg.policy,
    pricing: cfg.pricing,
    mode: cfg.mode,
    failMode: cfg.failMode,
    alerts,
    store: opts.store ?? new MemoryStore(),
  });
}
