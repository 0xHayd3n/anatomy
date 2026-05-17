// src/ingest/dedupe.ts
// Cross-file rule-text deduplication. Four-step normalization (lowercase,
// strip backticks, collapse whitespace, strip trailing punctuation) is
// comparison-only — the kept rule retains its original formatting.

import type { IngestedRule } from "./types.js";

export function normalizeRuleText(s: string): string {
  return s
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim();
}

export interface DedupeResult {
  kept: IngestedRule[];
  dropped: IngestedRule[];
}

export function dedupe(rules: IngestedRule[]): DedupeResult {
  const seen = new Map<string, IngestedRule>();
  const dropped: IngestedRule[] = [];
  for (const r of rules) {
    const key = normalizeRuleText(r.rule);
    if (seen.has(key)) {
      dropped.push(r);
    } else {
      seen.set(key, r);
    }
  }
  return { kept: [...seen.values()], dropped };
}
