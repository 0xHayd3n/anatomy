// src/render/memory-for-agents-md.ts
// Memory entry selection + ranking for the "Recent lived experience"
// section of AGENTS.md. Reuses decayBucket / decayMultiplier from
// src/memory/decay.ts. Deprecated entries are always excluded. Stale-
// bucket entries are included only with high recency.

import type { MemoryEntry } from "../memory/io.js";
import { decayBucket, decayMultiplier } from "../memory/decay.js";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const RECENCY_FLOOR_FOR_STALE = 0.7;

/** Returns the top-N memory entries ranked by
 *  `decayMultiplier(bucket) * recency(entry)`. Deprecated entries are
 *  filtered out. Stale entries are filtered out unless their recency
 *  score is above RECENCY_FLOOR_FOR_STALE. */
export function selectTopMemoryEntries(
  entries: MemoryEntry[],
  limit: number,
  now: Date = new Date(),
): MemoryEntry[] {
  const nowMs = now.getTime();

  const scored = entries
    .filter((e) => !e.deprecated_at)
    .map((e) => {
      const bucket = decayBucket(e, now);
      const lastTouch = e.last_verified_at ?? e.at;
      const ageMs = Math.max(0, nowMs - Date.parse(lastTouch));
      const ageYears = ageMs / ONE_YEAR_MS;
      const recency = Math.exp(-ageYears);
      if (bucket === "stale" && recency < RECENCY_FLOOR_FOR_STALE) {
        return { entry: e, score: -1 };
      }
      const multiplier = decayMultiplier(bucket);
      return { entry: e, score: multiplier * recency };
    })
    .filter((x) => x.score >= 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.entry);
}
