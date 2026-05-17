// src/verify-suggest/dry-run.ts
// Pre-display safety gate: run a candidate verify clause through verifyCheck
// and decide whether it's broken (reject) or legitimately reports drift (accept).

import { verifyCheck, type Warning } from "@anatomytool/validate";
import type { VerifyCandidate, DryRunResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 3000;

const BROKEN_CODES = new Set<string>([
  "verify-invalid-pattern",
  "verify-invalid-rule-file",
  "verify-ast-grep-unavailable",
  "verify-semgrep-unavailable",
  "verify-rule-file-missing",
  "verify-no-files-matched",
]);

const TIMEOUT = Symbol("dry-run-timeout");

function timeoutMs(): number {
  const v = process.env.ANATOMY_DRY_RUN_TIMEOUT_MS;
  return v && /^\d+$/.test(v) ? Number(v) : DEFAULT_TIMEOUT_MS;
}

function parseFirstHit(warnings: Warning[]): { file: string; line: number }[] {
  // Look for "path:line" in any warning message. Returns up to 5 sample hits
  // for the prompt to show. Same parser shape as staleness-per-rule's parseHits.
  const re = /([^\s,]+):(\d+)/g;
  const hits: { file: string; line: number }[] = [];
  for (const w of warnings) {
    const sep = w.message.indexOf(": ");
    if (sep === -1) continue;
    const tail = w.message.slice(sep + 2);
    for (const match of tail.matchAll(re)) {
      if (hits.length >= 5) return hits;
      hits.push({ file: match[1], line: Number(match[2]) });
    }
  }
  return hits;
}

export async function dryRun(
  repoRoot: string,
  candidate: VerifyCandidate,
): Promise<DryRunResult> {
  const syntheticDoc = { rules: [{ rule: "dry-run probe", verify: candidate }] };

  const timer = new Promise<typeof TIMEOUT>(resolve => {
    setTimeout(() => resolve(TIMEOUT), timeoutMs()).unref();
  });

  let outcome: Awaited<ReturnType<typeof verifyCheck>> | typeof TIMEOUT;
  try {
    outcome = await Promise.race([
      verifyCheck(syntheticDoc, { repoRoot }),
      timer,
    ]);
  } catch (err) {
    return {
      accepted: false,
      reason: `verifyCheck threw: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }

  if (outcome === TIMEOUT) {
    return { accepted: false, reason: `verifier timed out (>${timeoutMs()}ms)`, hits: [] };
  }

  // verify-rule-file-outside-repo is an ErrorCode and surfaces here, not in warnings.
  if (outcome.errors.length > 0) {
    return { accepted: false, reason: outcome.errors[0].message, hits: [] };
  }

  for (const w of outcome.warnings) {
    if (BROKEN_CODES.has(w.code)) {
      return { accepted: false, reason: w.message || `verifier reported ${w.code}`, hits: [] };
    }
  }

  return { accepted: true, hits: parseFirstHit(outcome.warnings) };
}
