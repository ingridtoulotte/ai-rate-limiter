import type { Store, UsageEntry } from "../types.js";

/**
 * Minimal subset of an ioredis / node-redis client. Pass any client that
 * implements these methods; ai-rate-limiter never imports a redis library
 * itself (keeps the dependency optional).
 */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  rpush?(key: string, value: string): Promise<number>;
  lrange?(key: string, start: number, stop: number): Promise<string[]>;
  ltrim?(key: string, start: number, stop: number): Promise<unknown>;
}

// Atomic increment + first-write expiry. Negative amounts (rollback/reconcile)
// never push the counter below zero and never clear the existing TTL.
const INCR_SCRIPT = `
local v = redis.call('INCRBY', KEYS[1], ARGV[1])
if v < 0 then redis.call('SET', KEYS[1], 0); v = 0 end
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return v`;

/**
 * Redis-backed store for multi-instance deployments. All counters are atomic
 * via a Lua script, so concurrent processes share one source of truth.
 */
export class RedisStore implements Store {
  constructor(
    private client: RedisLike,
    private prefix = "arl:",
    private usageKey = "arl:usage",
    private maxUsage = 5000,
  ) {}

  async incrBy(key: string, amount: number, ttlMs: number): Promise<number> {
    const v = await this.client.eval(INCR_SCRIPT, 1, this.prefix + key, Math.round(amount), Math.round(ttlMs));
    return Number(v);
  }

  async get(key: string): Promise<number> {
    const v = await this.client.get(this.prefix + key);
    return v ? Number(v) : 0;
  }

  async pushUsage(entry: UsageEntry): Promise<void> {
    if (!this.client.rpush) return;
    await this.client.rpush(this.usageKey, JSON.stringify(entry));
    if (this.client.ltrim) await this.client.ltrim(this.usageKey, -this.maxUsage, -1);
  }

  async recentUsage(limit?: number): Promise<UsageEntry[]> {
    if (!this.client.lrange) return [];
    const start = limit ? -limit : 0;
    const rows = await this.client.lrange(this.usageKey, start, -1);
    return rows.map((r) => JSON.parse(r) as UsageEntry);
  }
}
