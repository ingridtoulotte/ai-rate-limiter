import type { Store, UsageEntry } from "../types.js";

interface Counter { value: number; expiresAt: number; }

/**
 * In-process store. Fast, zero-dependency, single-instance only.
 * Counters use fixed-window keys (see windowInfo) and self-expire.
 */
export class MemoryStore implements Store {
  private counters = new Map<string, Counter>();
  private usage: UsageEntry[] = [];
  private readonly maxUsage: number;

  constructor(opts: { maxUsageEntries?: number } = {}) {
    this.maxUsage = opts.maxUsageEntries ?? 5000;
  }

  async incrBy(key: string, amount: number, ttlMs: number): Promise<number> {
    const now = Date.now();
    const c = this.counters.get(key);
    if (c && c.expiresAt > now) {
      c.value = Math.max(0, c.value + amount);
      c.expiresAt = Math.max(c.expiresAt, now + ttlMs);
      return c.value;
    }
    const value = Math.max(0, amount);
    this.counters.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  async get(key: string): Promise<number> {
    const c = this.counters.get(key);
    if (!c || c.expiresAt <= Date.now()) return 0;
    return c.value;
  }

  async pushUsage(entry: UsageEntry): Promise<void> {
    this.usage.push(entry);
    if (this.usage.length > this.maxUsage) this.usage.splice(0, this.usage.length - this.maxUsage);
  }

  async recentUsage(limit?: number): Promise<UsageEntry[]> {
    return limit ? this.usage.slice(-limit) : this.usage.slice();
  }

  /** drop expired counters (optional housekeeping) */
  sweep(): void {
    const now = Date.now();
    for (const [k, c] of this.counters) if (c.expiresAt <= now) this.counters.delete(k);
  }
}
