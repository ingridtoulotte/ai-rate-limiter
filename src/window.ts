import type { Window } from "./types.js";

const pad = (n: number) => String(n).padStart(2, "0");

export interface WindowInfo {
  /** unique bucket id for the current window instance */
  bucket: string;
  /** epoch ms when this window resets */
  resetAt: number;
  /** window length in ms */
  windowMs: number;
}

/**
 * Resolve a window definition into the current fixed-window bucket.
 * minute/hour are rolling fixed windows; day/month are UTC calendar windows
 * (matching how providers bill). A numeric window is a fixed window of N ms.
 */
export function windowInfo(window: Window, now: number = Date.now()): WindowInfo {
  if (typeof window === "number") {
    const start = Math.floor(now / window) * window;
    return { bucket: `ms${window}:${start}`, resetAt: start + window, windowMs: window };
  }
  const d = new Date(now);
  switch (window) {
    case "minute": {
      const w = 60_000;
      const s = Math.floor(now / w) * w;
      return { bucket: `min:${s}`, resetAt: s + w, windowMs: w };
    }
    case "hour": {
      const w = 3_600_000;
      const s = Math.floor(now / w) * w;
      return { bucket: `hr:${s}`, resetAt: s + w, windowMs: w };
    }
    case "day": {
      const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
      const start = Date.UTC(y, mo, da);
      const reset = Date.UTC(y, mo, da + 1);
      return { bucket: `day:${y}-${pad(mo + 1)}-${pad(da)}`, resetAt: reset, windowMs: reset - start };
    }
    case "month": {
      const y = d.getUTCFullYear(), mo = d.getUTCMonth();
      const start = Date.UTC(y, mo, 1);
      const reset = Date.UTC(y, mo + 1, 1);
      return { bucket: `mon:${y}-${pad(mo + 1)}`, resetAt: reset, windowMs: reset - start };
    }
    default: {
      const w = 60_000;
      const s = Math.floor(now / w) * w;
      return { bucket: `min:${s}`, resetAt: s + w, windowMs: w };
    }
  }
}

export function windowLabel(window: Window): string {
  if (typeof window === "number") return `${window}ms`;
  return window;
}
