import type { AlertHook, AlertEvent } from "./types.js";

function fmt(n: number): string {
  return n >= 1000 ? n.toLocaleString("en-US") : String(Math.round(n * 1000) / 1000);
}

/** Log warnings and limit breaches to the console. */
export function consoleAlert(opts: { prefix?: string } = {}): AlertHook {
  const p = opts.prefix ?? "[ai-rate-limiter]";
  return (e: AlertEvent) => {
    if (e.type === "warning") {
      const w = e.warning;
      console.warn(`${p} WARN  ${w.rule} ${w.scope}=${w.key} ${w.metric} at ${(w.ratio * 100).toFixed(0)}% (${fmt(w.used)}/${fmt(w.limit)})`);
    } else if (e.type === "limit_exceeded") {
      const l = e.limit;
      console.error(`${p} LIMIT ${l.rule} ${l.scope}=${l.key} ${l.metric} exceeded: ${fmt(l.used)}+${fmt(l.attempted)} > ${fmt(l.limit)}`);
    }
  };
}

/** POST alert events to a webhook (Slack/Discord-compatible if you shape payload). */
export function webhookAlert(
  url: string,
  opts: { headers?: Record<string, string>; types?: AlertEvent["type"][] } = {},
): AlertHook {
  const types = opts.types ?? ["warning", "limit_exceeded"];
  return async (e: AlertEvent) => {
    if (!types.includes(e.type)) return;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
        body: JSON.stringify({ ...e, at: Date.now() }),
      });
    } catch (err) {
      console.error("[ai-rate-limiter] webhook alert failed:", (err as Error).message);
    }
  };
}

/** Forward every event to a custom sink (metrics, queue, DB, etc.). */
export function callbackAlert(fn: (e: AlertEvent) => void | Promise<void>): AlertHook {
  return fn;
}
