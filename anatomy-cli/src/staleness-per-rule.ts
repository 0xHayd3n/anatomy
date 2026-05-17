// src/staleness-per-rule.ts
// Per-rule staleness: re-runs each rule's `verify` clause against HEAD when
// an anatomy is non-cosmetically stale, classifies each rule, and returns an
// array surfaced through the MCP envelope. Reuses verifyCheck from
// @anatomy/validate; no new verifier code.

import { verifyCheck } from "@anatomy/validate";
import type { Warning } from "@anatomy/validate";

export type RuleStatus = "passing" | "failing" | "unverified" | "error";

export interface RuleStaleness {
  index: number;
  status: RuleStatus;
  hits?: { file: string; line: number }[];
  error?: string;
}

const FAILING_CODES = new Set<string>([
  "verify-glob-empty",
  "verify-glob-unexpected-files",
  "verify-glob-outside-container",
  "verify-pattern-not-matched",
  "verify-pattern-found-where-forbidden",
]);

const HIT_CAP = 10;

const DEFAULT_TIMEOUT_MS = 5000;

function getTimeoutMs(): number {
  const v = process.env.ANATOMY_PER_RULE_TIMEOUT_MS;
  if (v && /^\d+$/.test(v)) return Number(v);
  return DEFAULT_TIMEOUT_MS;
}

const TIMEOUT_SENTINEL = Symbol("verify-timeout");

const MEMO_CAP = 8;
const memo = new Map<string, RuleStaleness[]>();

/** Test-only: clear the in-process memo. Not part of the public API. */
export function _resetMemo(): void {
  memo.clear();
}

// Match "<path>:<line>" pairs. Path is non-whitespace, non-comma. Line is digits.
// The full message format is: "...: path1:line1, path2:line2, ..." — we match
// every such pair, ignoring "..." and other separators.
const HIT_RE = /([^\s,]+):(\d+)/g;

export function parseHits(message: string): { file: string; line: number }[] {
  // Find the first ": " separator and parse pairs from there. This skips the
  // verifier's prose preamble and avoids false positives in the preamble
  // (e.g., if the glob string itself contains a colon).
  const sep = message.indexOf(": ");
  if (sep === -1) return [];
  const tail = message.slice(sep + 2);
  const hits: { file: string; line: number }[] = [];
  for (const match of tail.matchAll(HIT_RE)) {
    if (hits.length >= HIT_CAP) break;
    hits.push({ file: match[1], line: Number(match[2]) });
  }
  return hits;
}

export function classify(
  index: number,
  rule: { verify?: unknown },
  warnings: Warning[],
): RuleStaleness {
  if (!rule.verify || typeof rule.verify !== "object") {
    return { index, status: "unverified" };
  }
  const ours = warnings.filter(w => w.pointer === `/rules/${index}/verify`);
  if (ours.length === 0) {
    return { index, status: "passing" };
  }
  for (const w of ours) {
    if (FAILING_CODES.has(w.code)) {
      const result: RuleStaleness = { index, status: "failing" };
      if (w.code === "verify-pattern-found-where-forbidden") {
        const hits = parseHits(w.message);
        if (hits.length > 0) result.hits = hits;
      }
      return result;
    }
  }
  // Any other code (known error codes, or unrecognized verify-* codes) → error.
  const w = ours[0];
  return { index, status: "error", error: w.message || w.code };
}

export async function verifyRulesAtCommit(
  repoRoot: string,
  doc: { rules?: unknown[] },
  headCommit?: string,
): Promise<RuleStaleness[]> {
  const rules = Array.isArray(doc.rules) ? doc.rules : [];
  if (rules.length === 0) return [];

  if (headCommit && memo.has(headCommit)) {
    // LRU touch: re-insert to move to most-recently-used position.
    const cached = memo.get(headCommit)!;
    memo.delete(headCommit);
    memo.set(headCommit, cached);
    return cached;
  }

  const timeoutMs = getTimeoutMs();
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>(resolve => {
    setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs).unref();
  });

  const result = await Promise.race([
    verifyCheck(doc, { repoRoot }),
    timeoutPromise,
  ]);

  let perRule: RuleStaleness[];
  if (result === TIMEOUT_SENTINEL) {
    perRule = rules.map((rule, i) => {
      const r = (rule ?? {}) as { verify?: unknown };
      if (!r.verify || typeof r.verify !== "object") {
        return { index: i, status: "unverified" } as RuleStaleness;
      }
      return { index: i, status: "error", error: "verification timed out" } as RuleStaleness;
    });
  } else {
    perRule = rules.map((rule, i) =>
      classify(i, (rule ?? {}) as { verify?: unknown }, result.warnings),
    );
  }

  if (headCommit) {
    if (memo.size >= MEMO_CAP) {
      // Evict the oldest (first-inserted) key. Map preserves insertion order.
      const oldest = memo.keys().next().value;
      if (oldest !== undefined) memo.delete(oldest);
    }
    memo.set(headCommit, perRule);
  }
  return perRule;
}
