// src/memory/decay.ts
// Memory v0.2 decay-bucket logic. Computed at read time from each entry's
// last_verified_at (or its `at` field as fallback for "untouched" v0.1
// entries). Used by:
//   - `anatomy memory list` to surface recency-of-confirmation.
//   - `anatomy memory stats` to break down active counts by bucket.
//   - `anatomy_memory_search` MCP tool to apply rank multipliers.
//
// Default thresholds match the design doc (memory-v0.2-decay-design.md §5.2):
//   fresh:     last_verified_at ≤ 30 days ago
//   aging:     30–180 days ago
//   stale:     > 180 days ago
//   untouched: no last_verified_at field (use `at` as proxy)
//
// Multipliers are configurable via ANATOMY_MEMORY_DECAY_MULTIPLIERS env var
// (comma-separated `bucket:value` pairs). Unrecognized buckets are ignored;
// non-numeric values fall back to defaults. Out-of-range values
// (negative or > 1) are clamped to [0, 1] since boost > 1 doesn't make sense
// for a decay model.

import type { MemoryEntry } from "./io.js";

export type DecayBucket = "fresh" | "aging" | "stale" | "untouched";

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_DAYS = 30;
const STALE_DAYS = 180;

const DEFAULT_MULTIPLIERS: Record<DecayBucket, number> = {
  fresh: 1.0,
  aging: 0.85,
  stale: 0.6,
  untouched: 0.7,
};

let cachedMultipliers: Record<DecayBucket, number> | null = null;

function parseMultipliers(): Record<DecayBucket, number> {
  if (cachedMultipliers) return cachedMultipliers;
  const env = process.env.ANATOMY_MEMORY_DECAY_MULTIPLIERS;
  const out = { ...DEFAULT_MULTIPLIERS };
  if (typeof env === "string" && env.trim().length > 0) {
    for (const pair of env.split(",")) {
      const [rawKey, rawVal] = pair.split(":").map(s => s.trim());
      if (!rawKey || !rawVal) continue;
      if (!(rawKey in DEFAULT_MULTIPLIERS)) continue;
      const n = Number(rawVal);
      if (!Number.isFinite(n)) continue;
      out[rawKey as DecayBucket] = Math.max(0, Math.min(1, n));
    }
  }
  cachedMultipliers = out;
  return out;
}

/** Test-only: clear cached env multipliers so changes to
 *  ANATOMY_MEMORY_DECAY_MULTIPLIERS take effect. */
export function _resetDecayMultiplierCache(): void {
  cachedMultipliers = null;
}

export function decayBucket(entry: MemoryEntry, now: Date = new Date()): DecayBucket {
  // Entries that have never been explicitly verified (no last_verified_at
  // field) always bucket as "untouched", regardless of how recent their `at`
  // timestamp is. This preserves the distinction between "explicitly
  // confirmed recently" (fresh) and "never confirmed but new" (untouched) —
  // a v0.1 entry written today and a v0.2 entry verified today should rank
  // differently because the verification act itself is the signal we're
  // tracking. The "untouched" multiplier (0.7 by default) sits between
  // aging (0.85) and stale (0.6).
  if (typeof entry.last_verified_at !== "string") return "untouched";
  return ageBucket(entry.last_verified_at, now);
}

/** Map a verification timestamp to fresh / aging / stale based on age. */
function ageBucket(timestamp: string, now: Date): "fresh" | "aging" | "stale" {
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts)) return "stale"; // Unparseable timestamp: treat as worst-case
  const ageDays = (now.getTime() - ts) / DAY_MS;
  if (ageDays <= FRESH_DAYS) return "fresh";
  if (ageDays <= STALE_DAYS) return "aging";
  return "stale";
}

export function decayMultiplier(bucket: DecayBucket): number {
  return parseMultipliers()[bucket];
}

/** Sum-over-bucket helper for `anatomy memory stats`. */
export function bucketCounts(entries: MemoryEntry[], now: Date = new Date()): Record<DecayBucket, number> {
  const acc: Record<DecayBucket, number> = { fresh: 0, aging: 0, stale: 0, untouched: 0 };
  for (const e of entries) acc[decayBucket(e, now)]++;
  return acc;
}
